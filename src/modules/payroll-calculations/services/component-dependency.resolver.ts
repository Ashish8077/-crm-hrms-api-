import { HttpStatus, Injectable } from '@nestjs/common';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { StructureComponentCalculationType } from '../../salary-structures/constants/salary-structure.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ResolvedSalaryComponent } from './salary-component.resolver';

const AGGREGATE_GROSS_BASES = new Set(['GROSS_SALARY', 'GROSS_EARNINGS']);

@Injectable()
export class ComponentDependencyResolver {
  resolveExecutionOrder(
    components: ResolvedSalaryComponent[],
    configuredOrder: string[],
    hasTargetMonthlyGross: boolean,
  ): ResolvedSalaryComponent[] {
    const nodeByCode = new Map<string, ResolvedSalaryComponent>();
    for (const comp of components) {
      nodeByCode.set(comp.code, comp);
    }

    const earningCodes = components
      .filter((c) => c.classification === SalaryComponentType.EARNING)
      .map((c) => c.code);
    const nonBalanceEarningCodes = components
      .filter(
        (c) =>
          c.classification === SalaryComponentType.EARNING &&
          c.calculationMethod !== StructureComponentCalculationType.BALANCE,
      )
      .map((c) => c.code);

    const dependenciesByCode = new Map<string, string[]>();

    for (const comp of components) {
      if (
        comp.calculationMethod === StructureComponentCalculationType.BALANCE
      ) {
        if (comp.classification !== SalaryComponentType.EARNING) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `BALANCE calculationType is supported only for EARNING components (found '${comp.classification}' for component '${comp.code}').`,
            HttpStatus.BAD_REQUEST,
          );
        }
        // BALANCE depends on all non-BALANCE EARNING components (FIXED & PERCENTAGE)
        dependenciesByCode.set(comp.code, [...nonBalanceEarningCodes]);
        continue;
      }

      if (
        comp.calculationMethod !== StructureComponentCalculationType.PERCENTAGE
      ) {
        dependenciesByCode.set(comp.code, []);
        continue;
      }

      const base = comp.percentageOf!;

      if (AGGREGATE_GROSS_BASES.has(base)) {
        if (comp.classification === SalaryComponentType.EARNING) {
          if (base === 'GROSS_SALARY' && hasTargetMonthlyGross) {
            // Structure explicitly defines target Gross Salary (or solved Gross from CTC snapshot)
            dependenciesByCode.set(comp.code, []);
          } else {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              `Circular calculation dependency: earning component '${comp.code}' cannot depend on '${base}'.`,
              HttpStatus.BAD_REQUEST,
            );
          }
        } else {
          // Deductions or employer contributions depending on GROSS wait for all EARNING components
          dependenciesByCode.set(comp.code, [...earningCodes]);
        }
      } else if (base === 'BASIC_AND_DA') {
        if (!nodeByCode.has('BASIC')) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Missing percentage base component 'BASIC' required by '${comp.code}' (BASIC_AND_DA).`,
            HttpStatus.BAD_REQUEST,
          );
        }
        const deps = ['BASIC'];
        if (nodeByCode.has('DA')) {
          deps.push('DA');
        }
        dependenciesByCode.set(comp.code, deps);
      } else {
        if (base === comp.code) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Circular calculation dependency detected: ${comp.code} -> ${comp.code}`,
            HttpStatus.BAD_REQUEST,
          );
        }
        if (!nodeByCode.has(base)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Missing percentage base component '${base}' required by '${comp.code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        dependenciesByCode.set(comp.code, [base]);
      }
    }

    // Sort deterministically: EARNING first, then configured execution order, then code alphabetical
    // Guarantees zero reliance on MongoDB array or document ordering
    const orderRank = new Map<string, number>();
    configuredOrder.forEach((code, idx) => {
      orderRank.set(code.trim().toUpperCase(), idx);
    });

    const prioritized = [...components].sort((a, b) => {
      const aEarn = a.classification === SalaryComponentType.EARNING ? 0 : 1;
      const bEarn = b.classification === SalaryComponentType.EARNING ? 0 : 1;
      if (aEarn !== bEarn) return aEarn - bEarn;

      const aBalance =
        a.calculationMethod === StructureComponentCalculationType.BALANCE
          ? 1
          : 0;
      const bBalance =
        b.calculationMethod === StructureComponentCalculationType.BALANCE
          ? 1
          : 0;
      if (aBalance !== bBalance) return aBalance - bBalance;

      const aRank = orderRank.get(a.code) ?? Number.MAX_SAFE_INTEGER;
      const bRank = orderRank.get(b.code) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;

      return a.code.localeCompare(b.code);
    });

    const state = new Map<string, 'visiting' | 'visited'>();
    const sorted: ResolvedSalaryComponent[] = [];

    const visit = (comp: ResolvedSalaryComponent, trail: string[]): void => {
      const currentState = state.get(comp.code);
      if (currentState === 'visited') return;
      if (currentState === 'visiting') {
        const cycleStart = trail.indexOf(comp.code);
        const cyclePath = [...trail.slice(cycleStart), comp.code].join(' -> ');
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Circular calculation dependency detected: ${cyclePath}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      state.set(comp.code, 'visiting');
      const deps = dependenciesByCode.get(comp.code) ?? [];
      for (const depCode of deps) {
        const depNode = nodeByCode.get(depCode);
        if (depNode) {
          visit(depNode, [...trail, comp.code]);
        }
      }
      state.set(comp.code, 'visited');
      sorted.push(comp);
    };

    for (const comp of prioritized) {
      if (!state.has(comp.code)) {
        visit(comp, []);
      }
    }

    return sorted;
  }
}

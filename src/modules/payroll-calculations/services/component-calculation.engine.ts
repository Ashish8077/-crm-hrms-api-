import { HttpStatus, Injectable } from '@nestjs/common';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { StructureComponentCalculationType } from '../../salary-structures/constants/salary-structure.constant';
import {
  computePercentage,
  Decimal,
  toDecimal,
} from '../../../common/utils/financial-math.util';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ResolvedSalaryComponent } from './salary-component.resolver';

export interface MonthlyCalculatedComponent {
  component: ResolvedSalaryComponent;
  monthlyBaseAmountDec: Decimal;
  monthlyCalculatedAmountDec: Decimal;
}

@Injectable()
export class ComponentCalculationEngine {
  /**
   * Calculates full monthly amounts for all components in topological dependency order.
   * Percentage components are ALWAYS evaluated against FULL MONTHLY BASE AMOUNTS
   * prior to any payable-days proration.
   */
  calculateMonthlyAmounts(
    orderedComponents: ResolvedSalaryComponent[],
    targetMonthlyGross: Decimal | null,
  ): MonthlyCalculatedComponent[] {
    const resolvedMonthlyValues = new Map<string, Decimal>();
    let runningMonthlyGrossEarnings = toDecimal(0);
    const results: MonthlyCalculatedComponent[] = [];

    for (const comp of orderedComponents) {
      let monthlyBaseAmountDec: Decimal;
      let monthlyCalculatedAmountDec: Decimal;

      if (comp.calculationMethod === StructureComponentCalculationType.FIXED) {
        monthlyBaseAmountDec = comp.monthlyFixedAmount!;
        monthlyCalculatedAmountDec = comp.monthlyFixedAmount!;
      } else if (
        comp.calculationMethod === StructureComponentCalculationType.BALANCE
      ) {
        if (comp.classification !== SalaryComponentType.EARNING) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `BALANCE calculationType is supported only for EARNING components (found '${comp.classification}' for component '${comp.code}').`,
            HttpStatus.BAD_REQUEST,
          );
        }
        if (targetMonthlyGross === null) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Target monthly gross is required to calculate BALANCE component '${comp.code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        monthlyBaseAmountDec = targetMonthlyGross;
        const balanceDec = targetMonthlyGross.minus(
          runningMonthlyGrossEarnings,
        );
        if (balanceDec.lessThan(0)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Other monthly earnings (${runningMonthlyGrossEarnings.toFixed(2)}) exceed target monthly gross (${targetMonthlyGross.toFixed(2)}). BALANCE component '${comp.code}' cannot be negative.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        monthlyCalculatedAmountDec = balanceDec;
      } else {
        const baseCode = comp.percentageOf!;

        if (baseCode === 'GROSS_SALARY' || baseCode === 'GROSS_EARNINGS') {
          if (
            comp.classification === SalaryComponentType.EARNING &&
            targetMonthlyGross !== null
          ) {
            monthlyBaseAmountDec = targetMonthlyGross;
          } else {
            monthlyBaseAmountDec = runningMonthlyGrossEarnings;
          }
        } else if (baseCode === 'BASIC_AND_DA') {
          const basicVal = resolvedMonthlyValues.get('BASIC') ?? toDecimal(0);
          const daVal = resolvedMonthlyValues.get('DA') ?? toDecimal(0);
          monthlyBaseAmountDec = basicVal.plus(daVal);
        } else {
          monthlyBaseAmountDec =
            resolvedMonthlyValues.get(baseCode) ?? toDecimal(0);
        }

        monthlyCalculatedAmountDec = computePercentage(
          monthlyBaseAmountDec,
          comp.percentage!,
        );
      }

      resolvedMonthlyValues.set(comp.code, monthlyCalculatedAmountDec);
      if (comp.classification === SalaryComponentType.EARNING) {
        runningMonthlyGrossEarnings = runningMonthlyGrossEarnings.plus(
          monthlyCalculatedAmountDec,
        );
      }

      results.push({
        component: comp,
        monthlyBaseAmountDec,
        monthlyCalculatedAmountDec,
      });
    }

    return results;
  }
}

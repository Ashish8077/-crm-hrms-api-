import { Injectable } from '@nestjs/common';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { StructureComponentCalculationType } from '../../salary-structures/constants/salary-structure.constant';
import { PayrollProrationPolicy } from '../../payroll-configuration/constants/payroll-configuration.constant';
import { Decimal, toDecimal } from '../../../common/utils/financial-math.util';
import { roundDecimal } from '../constants/payroll-calculation.constant';
import { MonthlyCalculatedComponent } from './component-calculation.engine';
import { ResolvedPayrollConfiguration } from './payroll-input.resolver';

export interface ProratedComponentResult {
  componentId: string;
  componentCode: string;
  componentName: string;
  classification: SalaryComponentType;
  calculationMethod: StructureComponentCalculationType;
  percentage: number | null;
  percentageOf: string | null;
  monthlyBaseAmountDec: Decimal;
  monthlyCalculatedAmountDec: Decimal;
  prorationApplied: boolean;
  payableDays: number;
  calendarDays: number;
  finalAmountDec: Decimal;
}

export interface ProrationResult {
  calendarDays: number;
  prorationDenominatorDays: number;
  payableDays: number;
  prorationApplied: boolean;
  prorationFactor: Decimal;
  components: ProratedComponentResult[];
}

@Injectable()
export class ProrationCalculator {
  /**
   * Applies configured proration rules after full monthly component amounts
   * have been calculated, preserving Decimal precision until final component rounding.
   */
  applyProration(
    monthlyComponents: MonthlyCalculatedComponent[],
    calendarDays: number,
    payableDays: number,
    config: ResolvedPayrollConfiguration,
  ): ProrationResult {
    const prorationDenominatorDays = this.resolveDenominatorDays(
      calendarDays,
      config,
    );

    let prorationApplied = false;
    let prorationFactor = toDecimal(1);

    if (payableDays < prorationDenominatorDays) {
      prorationApplied = true;
      if (payableDays === 0) {
        prorationFactor = toDecimal(0);
      } else {
        prorationFactor = toDecimal(payableDays).dividedBy(
          prorationDenominatorDays,
        );
      }
    }

    const components: ProratedComponentResult[] = monthlyComponents.map(
      (item) => {
        const { component, monthlyBaseAmountDec, monthlyCalculatedAmountDec } =
          item;

        const shouldProrateComponent = this.shouldProrateComponent(
          component.classification,
          component.calculationMethod,
          prorationApplied && !prorationFactor.equals(1),
          config,
        );

        const rawFinalDec = shouldProrateComponent
          ? monthlyCalculatedAmountDec.times(prorationFactor)
          : monthlyCalculatedAmountDec;

        const finalAmountDec = roundDecimal(
          rawFinalDec,
          config.roundingPrecision,
          config.roundingMode,
        );

        const roundedMonthlyBaseDec = roundDecimal(
          monthlyBaseAmountDec,
          config.roundingPrecision,
          config.roundingMode,
        );

        const roundedMonthlyCalculatedDec = roundDecimal(
          monthlyCalculatedAmountDec,
          config.roundingPrecision,
          config.roundingMode,
        );

        return {
          componentId: component.componentId,
          componentCode: component.code,
          componentName: component.name,
          classification: component.classification,
          calculationMethod: component.calculationMethod,
          percentage: component.percentage,
          percentageOf: component.percentageOf,
          monthlyBaseAmountDec: roundedMonthlyBaseDec,
          monthlyCalculatedAmountDec: roundedMonthlyCalculatedDec,
          prorationApplied: shouldProrateComponent,
          payableDays,
          calendarDays,
          finalAmountDec,
        };
      },
    );

    return {
      calendarDays,
      prorationDenominatorDays,
      payableDays,
      prorationApplied,
      prorationFactor,
      components,
    };
  }

  private resolveDenominatorDays(
    calendarDays: number,
    config: ResolvedPayrollConfiguration,
  ): number {
    if (config.prorationPolicy === PayrollProrationPolicy.FIXED_30_DAYS) {
      return 30;
    }
    if (
      config.prorationPolicy === PayrollProrationPolicy.WORKING_DAYS &&
      config.fixedWorkingDaysPerMonth &&
      config.fixedWorkingDaysPerMonth > 0
    ) {
      return config.fixedWorkingDaysPerMonth;
    }
    return calendarDays;
  }

  private shouldProrateComponent(
    classification: SalaryComponentType,
    calculationMethod: StructureComponentCalculationType,
    isPartialPeriod: boolean,
    config: ResolvedPayrollConfiguration,
  ): boolean {
    if (!isPartialPeriod) return false;

    if (classification === SalaryComponentType.EARNING) {
      if (calculationMethod === StructureComponentCalculationType.FIXED) {
        return config.prorateFixedComponents;
      }
      // Percentage earnings are calculated on full monthly bases first, then prorated
      return true;
    }

    if (classification === SalaryComponentType.EMPLOYEE_DEDUCTION) {
      return config.prorateDeductions;
    }

    if (classification === SalaryComponentType.EMPLOYER_CONTRIBUTION) {
      return config.prorateEmployerContributions;
    }

    return false;
  }
}

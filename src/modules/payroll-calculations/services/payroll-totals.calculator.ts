import { HttpStatus, Injectable } from '@nestjs/common';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { NegativeNetPayPolicy } from '../../payroll-configuration/constants/payroll-configuration.constant';
import { Decimal, toDecimal } from '../../../common/utils/financial-math.util';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { roundDecimal } from '../constants/payroll-calculation.constant';
import { ResolvedPayrollConfiguration } from './payroll-input.resolver';
import { ProratedComponentResult } from './proration.calculator';

export interface PayrollTotalsResult {
  earnings: ProratedComponentResult[];
  deductions: ProratedComponentResult[];
  employerContributions: ProratedComponentResult[];
  grossEarningsDec: Decimal;
  totalDeductionsDec: Decimal;
  employerContributionsDec: Decimal;
  netSalaryDec: Decimal;
  netPayClamped: boolean;
}

@Injectable()
export class PayrollTotalsCalculator {
  calculateTotals(
    components: ProratedComponentResult[],
    config: ResolvedPayrollConfiguration,
  ): PayrollTotalsResult {
    const earnings: ProratedComponentResult[] = [];
    const deductions: ProratedComponentResult[] = [];
    const employerContributions: ProratedComponentResult[] = [];

    for (const item of components) {
      if (item.classification === SalaryComponentType.EARNING) {
        earnings.push(item);
      } else if (
        item.classification === SalaryComponentType.EMPLOYEE_DEDUCTION
      ) {
        deductions.push(item);
      } else {
        employerContributions.push(item);
      }
    }

    const grossEarningsRaw = earnings.reduce(
      (sum, item) => sum.plus(item.finalAmountDec),
      toDecimal(0),
    );
    const totalDeductionsRaw = deductions.reduce(
      (sum, item) => sum.plus(item.finalAmountDec),
      toDecimal(0),
    );
    const employerContributionsRaw = employerContributions.reduce(
      (sum, item) => sum.plus(item.finalAmountDec),
      toDecimal(0),
    );

    const grossEarningsDec = roundDecimal(
      grossEarningsRaw,
      config.roundingPrecision,
      config.roundingMode,
    );
    const totalDeductionsDec = roundDecimal(
      totalDeductionsRaw,
      config.roundingPrecision,
      config.roundingMode,
    );
    const employerContributionsDec = roundDecimal(
      employerContributionsRaw,
      config.roundingPrecision,
      config.roundingMode,
    );

    // Employer contributions are tracked separately and MUST NOT reduce employee net salary
    let netSalaryDec = roundDecimal(
      grossEarningsDec.minus(totalDeductionsDec),
      config.roundingPrecision,
      config.roundingMode,
    );
    let netPayClamped = false;

    if (netSalaryDec.lessThan(0)) {
      if (config.negativeNetPayPolicy === NegativeNetPayPolicy.REJECT) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Total deductions (${totalDeductionsDec.toFixed(config.roundingPrecision)}) exceed gross earnings (${grossEarningsDec.toFixed(config.roundingPrecision)}), resulting in negative net salary (${netSalaryDec.toFixed(config.roundingPrecision)}).`,
          HttpStatus.BAD_REQUEST,
        );
      }
      netSalaryDec = toDecimal(0);
      netPayClamped = true;
    }

    return {
      earnings,
      deductions,
      employerContributions,
      grossEarningsDec,
      totalDeductionsDec,
      employerContributionsDec,
      netSalaryDec,
      netPayClamped,
    };
  }
}

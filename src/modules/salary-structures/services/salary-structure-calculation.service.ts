import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
  StructureComponentPercentageBasis,
} from '../constants/salary-structure.constant';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { SalaryComponentLean } from '../../salary-components/schemas/salary-component.schema';
import {
  computePercentage,
  Decimal,
  isMonetaryEqual,
  roundBankers,
  toDecimal,
} from '../../../common/utils/financial-math.util';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';

export interface CalculationComponentInput {
  componentId: Types.ObjectId | string;
  calculationType: StructureComponentCalculationType;
  amount?: number | null;
  percentage?: number | null;
  percentageOf?: StructureComponentPercentageBasis | null;
}

export interface CalculationMasterMap {
  [componentIdString: string]: SalaryComponentLean;
}

export interface CalculateBreakupParams {
  salaryBasis: SalaryStructureBasis;
  salaryFrequency: SalaryStructureFrequency;
  salaryAmount: number;
  components: CalculationComponentInput[];
  masterMap: CalculationMasterMap;
}

export interface SalaryBreakupLineItem {
  componentId: string;
  name: string;
  code: string;
  type: SalaryComponentType;
  calculationType: StructureComponentCalculationType;
  monthlyAmount: number;
  annualAmount: number;
}

export interface SalaryBreakupPeriodSummary {
  grossSalary: number;
  employerContributions: number;
  totalCtc: number;
  employeeDeductions: number;
  estimatedNetSalary: number;
}

export interface ComponentCalculationDiagnostic {
  componentId: string;
  code: string;
  name: string;
  category: SalaryComponentType;
  calculationType: StructureComponentCalculationType;
  calculationBase: StructureComponentPercentageBasis | 'FIXED' | 'BALANCE';
  frequency: SalaryStructureFrequency;
  resolvedPeriodAmount: number;
  monthlyAmount: number;
  annualAmount: number;
}

export interface SalaryStructureBreakupResult {
  salaryBasis: SalaryStructureBasis;
  salaryFrequency: SalaryStructureFrequency;
  inputSalaryAmount: number;
  grossSalaryMonthly: number;
  grossSalaryAnnual: number;
  totalEmployerContributionsMonthly: number;
  totalEmployerContributionsAnnual: number;
  totalCtcMonthly: number;
  totalCtcAnnual: number;
  totalEmployeeDeductionsMonthly: number;
  totalEmployeeDeductionsAnnual: number;
  estimatedNetSalaryMonthly: number;
  estimatedNetSalaryAnnual: number;
  summary?: {
    monthly: SalaryBreakupPeriodSummary;
    annual: SalaryBreakupPeriodSummary;
  };
  earnings: SalaryBreakupLineItem[];
  employeeDeductions: SalaryBreakupLineItem[];
  employerContributions: SalaryBreakupLineItem[];
  diagnostics?: ComponentCalculationDiagnostic[];
}

interface ComponentItemWithMaster {
  input: CalculationComponentInput;
  master: SalaryComponentLean;
}

@Injectable()
export class SalaryStructureCalculationService {
  private readonly logger = new Logger(SalaryStructureCalculationService.name);

  /**
   * Emits calculation diagnostics strictly at debug level and restricts output in production
   * to prevent exposure of sensitive compensation details in production log aggregators.
   */
  private logDebug(message: string): void {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug(message);
    }
  }

  /**
   * Evaluates and reconciles salary structure components against the selected basis and frequency.
   * Calculations are executed strictly in the structure's configured frequency period (annual or monthly)
   * to ensure annual amounts and monthly amounts are never mixed during deduction and balance solving.
   */
  calculate(params: CalculateBreakupParams): SalaryStructureBreakupResult {
    const {
      salaryBasis,
      salaryFrequency,
      salaryAmount,
      components,
      masterMap,
    } = params;

    if (salaryAmount <= 0 || !isFinite(salaryAmount)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Salary amount must be a positive number greater than 0',
        HttpStatus.BAD_REQUEST,
      );
    }

    const isAnnual = salaryFrequency === SalaryStructureFrequency.ANNUAL;
    const periodInput = toDecimal(salaryAmount);

    this.logDebug(
      `Starting salary structure calculation [Basis: ${salaryBasis}, Frequency: ${salaryFrequency}, Period Amount: ${salaryAmount}]`,
    );

    // 1. Map and categorize components using the authoritative masterMap
    const categorized = this.categorizeComponents(components, masterMap);

    // 2. Resolve Basic Component
    const basicItem = categorized.earnings.find(
      (item) => item.master.code.toUpperCase() === 'BASIC',
    );

    // Verify whether any component depends on BASIC
    const hasBasicDependency = components.some(
      (c) =>
        c.calculationType === StructureComponentCalculationType.PERCENTAGE &&
        c.percentageOf === StructureComponentPercentageBasis.BASIC,
    );

    if (hasBasicDependency && !basicItem) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "Components configured with percentage of 'BASIC' require a component with code 'BASIC' in the structure.",
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. Branch calculation and reconciliation based on salaryBasis in frequency period units
    let grossPeriod: Decimal;
    let basicPeriod: Decimal;
    let employerCostPeriod: Decimal;
    let ctcPeriod: Decimal;

    const earningsMap = new Map<string, Decimal>();
    const employerCostMap = new Map<string, Decimal>();
    const deductionsMap = new Map<string, Decimal>();

    if (salaryBasis === SalaryStructureBasis.GROSS) {
      grossPeriod = periodInput;

      // Determine Basic
      basicPeriod = this.evaluateBasicComponent(basicItem, grossPeriod);
      if (basicItem) {
        earningsMap.set(basicItem.master._id.toString(), basicPeriod);
      }

      // Evaluate non-balance earnings
      let otherEarningsSum = basicItem ? basicPeriod : toDecimal(0);
      const balanceEarning = categorized.earnings.find(
        (e) =>
          e.input.calculationType === StructureComponentCalculationType.BALANCE,
      );

      for (const earning of categorized.earnings) {
        if (earning === basicItem || earning === balanceEarning) continue;
        const val = this.evaluateComponentValue(
          earning.input,
          grossPeriod,
          basicPeriod,
        );
        earningsMap.set(earning.master._id.toString(), val);
        otherEarningsSum = otherEarningsSum.plus(val);
      }

      // Reconcile balance or total earnings
      if (balanceEarning) {
        const balanceVal = grossPeriod.minus(otherEarningsSum);
        if (balanceVal.lessThan(0)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Configured earnings (${roundBankers(otherEarningsSum)}) exceed Gross Salary (${roundBankers(grossPeriod)}). Balance cannot be negative.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        earningsMap.set(balanceEarning.master._id.toString(), balanceVal);
      } else {
        if (!isMonetaryEqual(otherEarningsSum, grossPeriod, 0.05)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Sum of configured earnings (${roundBankers(otherEarningsSum)}) does not equal Gross Salary (${roundBankers(grossPeriod)}).`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // Evaluate Employer Contributions
      let totalEmpCost = toDecimal(0);
      for (const contrib of categorized.employerContributions) {
        const val = this.evaluateComponentValue(
          contrib.input,
          grossPeriod,
          basicPeriod,
        );
        employerCostMap.set(contrib.master._id.toString(), val);
        totalEmpCost = totalEmpCost.plus(val);
      }
      employerCostPeriod = totalEmpCost;
      ctcPeriod = grossPeriod.plus(employerCostPeriod);
    } else {
      // salaryBasis === CTC
      ctcPeriod = periodInput;

      // In CTC mode, solve for Gross: Gross * (1 + R_gross) + F_emp = CTC
      const { derivedGross, derivedBasic } = this.resolveGrossFromCtc(
        ctcPeriod,
        basicItem,
        categorized.employerContributions,
      );

      grossPeriod = derivedGross;
      basicPeriod = derivedBasic;

      if (basicItem) {
        earningsMap.set(basicItem.master._id.toString(), basicPeriod);
      }

      // Evaluate non-balance earnings
      let otherEarningsSum = basicItem ? basicPeriod : toDecimal(0);
      const balanceEarning = categorized.earnings.find(
        (e) =>
          e.input.calculationType === StructureComponentCalculationType.BALANCE,
      );

      for (const earning of categorized.earnings) {
        if (earning === basicItem || earning === balanceEarning) continue;
        const val = this.evaluateComponentValue(
          earning.input,
          grossPeriod,
          basicPeriod,
        );
        earningsMap.set(earning.master._id.toString(), val);
        otherEarningsSum = otherEarningsSum.plus(val);
      }

      // Reconcile balance or verify exact sum
      if (balanceEarning) {
        const balanceVal = grossPeriod.minus(otherEarningsSum);
        if (balanceVal.lessThan(0)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Derived Gross Salary (${roundBankers(grossPeriod)}) is insufficient to cover configured fixed and percentage earnings (${roundBankers(otherEarningsSum)}).`,
            HttpStatus.BAD_REQUEST,
          );
        }
        earningsMap.set(balanceEarning.master._id.toString(), balanceVal);
      } else {
        if (!isMonetaryEqual(otherEarningsSum, grossPeriod, 0.05)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Configured earnings (${roundBankers(otherEarningsSum)}) do not reconcile with Gross Salary derived from CTC (${roundBankers(grossPeriod)}).`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // Evaluate employer contributions
      let totalEmpCost = toDecimal(0);
      for (const contrib of categorized.employerContributions) {
        const val = this.evaluateComponentValue(
          contrib.input,
          grossPeriod,
          basicPeriod,
        );
        employerCostMap.set(contrib.master._id.toString(), val);
        totalEmpCost = totalEmpCost.plus(val);
      }
      employerCostPeriod = totalEmpCost;

      // Final reconciliation check: CTC = Gross + Employer Contributions
      const actualCtc = grossPeriod.plus(employerCostPeriod);
      if (!isMonetaryEqual(actualCtc, ctcPeriod, 0.05)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `CTC reconciliation error: Gross (${roundBankers(grossPeriod)}) + Employer Contributions (${roundBankers(employerCostPeriod)}) != CTC (${roundBankers(ctcPeriod)})`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // 4. Evaluate Employee Deductions & Net Salary
    let totalDeductionsPeriod = toDecimal(0);
    for (const deduction of categorized.employeeDeductions) {
      const val = this.evaluateComponentValue(
        deduction.input,
        grossPeriod,
        basicPeriod,
      );
      deductionsMap.set(deduction.master._id.toString(), val);
      totalDeductionsPeriod = totalDeductionsPeriod.plus(val);
    }

    const estimatedNetPeriod = grossPeriod.minus(totalDeductionsPeriod);

    // 5. Build intermediate calculation diagnostics for each component
    const diagnostics: ComponentCalculationDiagnostic[] = [];
    const recordDiagnostic = (
      item: ComponentItemWithMaster,
      resolvedPeriodVal: Decimal,
    ) => {
      let calculationBase:
        StructureComponentPercentageBasis | 'FIXED' | 'BALANCE';
      if (
        item.input.calculationType === StructureComponentCalculationType.FIXED
      ) {
        calculationBase = 'FIXED';
      } else if (
        item.input.calculationType === StructureComponentCalculationType.BALANCE
      ) {
        calculationBase = 'BALANCE';
      } else {
        calculationBase =
          item.input.percentageOf ?? StructureComponentPercentageBasis.BASIC;
      }

      const periodAmount = roundBankers(resolvedPeriodVal, 2);
      const monthlyAmount = isAnnual
        ? roundBankers(toDecimal(periodAmount).dividedBy(12), 2)
        : periodAmount;
      const annualAmount = isAnnual
        ? periodAmount
        : roundBankers(toDecimal(periodAmount).times(12), 2);

      const diag: ComponentCalculationDiagnostic = {
        componentId: item.master._id.toString(),
        code: item.master.code,
        name: item.master.name,
        category:
          item.master.type === SalaryComponentType.DEDUCTION
            ? SalaryComponentType.EMPLOYEE_DEDUCTION
            : item.master.type,
        calculationType: item.input.calculationType,
        calculationBase,
        frequency: salaryFrequency,
        resolvedPeriodAmount: periodAmount,
        monthlyAmount,
        annualAmount,
      };

      diagnostics.push(diag);
      this.logDebug(
        `[Diagnostic] Component '${diag.code}' (${diag.name}) | Category: ${diag.category} | Frequency: ${diag.frequency} | Type: ${diag.calculationType} | Base: ${diag.calculationBase} | Period: ₹${diag.resolvedPeriodAmount} | Monthly: ₹${diag.monthlyAmount} | Annual: ₹${diag.annualAmount}`,
      );
    };

    for (const item of categorized.earnings) {
      recordDiagnostic(
        item,
        earningsMap.get(item.master._id.toString()) ?? toDecimal(0),
      );
    }
    for (const item of categorized.employerContributions) {
      recordDiagnostic(
        item,
        employerCostMap.get(item.master._id.toString()) ?? toDecimal(0),
      );
    }
    for (const item of categorized.employeeDeductions) {
      recordDiagnostic(
        item,
        deductionsMap.get(item.master._id.toString()) ?? toDecimal(0),
      );
    }

    this.logDebug(
      `[Diagnostic] Summary [Frequency: ${salaryFrequency}] | Total CTC: ₹${roundBankers(ctcPeriod)} | Gross: ₹${roundBankers(grossPeriod)} | Employer Cost: ₹${roundBankers(employerCostPeriod)} | Employee Deductions: ₹${roundBankers(totalDeductionsPeriod)} | Estimated Net: ₹${roundBankers(estimatedNetPeriod)}`,
    );

    // 6. Assemble line items and return formatted result with banker's rounding
    return this.buildBreakupResponse({
      salaryBasis,
      salaryFrequency,
      inputSalaryAmount: salaryAmount,
      isAnnual,
      grossPeriod,
      employerCostPeriod,
      ctcPeriod,
      totalDeductionsPeriod,
      estimatedNetPeriod,
      categorized,
      earningsMap,
      deductionsMap,
      employerCostMap,
      diagnostics,
    });
  }

  private categorizeComponents(
    components: CalculationComponentInput[],
    masterMap: CalculationMasterMap,
  ): {
    earnings: ComponentItemWithMaster[];
    employeeDeductions: ComponentItemWithMaster[];
    employerContributions: ComponentItemWithMaster[];
  } {
    const earnings: ComponentItemWithMaster[] = [];
    const employeeDeductions: ComponentItemWithMaster[] = [];
    const employerContributions: ComponentItemWithMaster[] = [];

    for (const input of components) {
      const idStr = input.componentId.toString();
      const master = masterMap[idStr];
      if (!master) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Referenced SalaryComponent '${idStr}' not found in catalog`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (
        input.calculationType === StructureComponentCalculationType.BALANCE &&
        master.type !== SalaryComponentType.EARNING
      ) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `BALANCE calculationType is only supported for EARNING components (found on: '${master.name}')`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const itemWithMaster: ComponentItemWithMaster = { input, master };

      if (master.type === SalaryComponentType.EARNING) {
        earnings.push(itemWithMaster);
      } else if (
        master.type === SalaryComponentType.EMPLOYEE_DEDUCTION ||
        master.type === SalaryComponentType.DEDUCTION
      ) {
        employeeDeductions.push(itemWithMaster);
      } else if (master.type === SalaryComponentType.EMPLOYER_CONTRIBUTION) {
        employerContributions.push(itemWithMaster);
      } else {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Unsupported component category: '${String(master.type)}'`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return { earnings, employeeDeductions, employerContributions };
  }

  private evaluateBasicComponent(
    basicItem: ComponentItemWithMaster | undefined,
    grossPeriod: Decimal,
  ): Decimal {
    if (!basicItem) return toDecimal(0);
    const { calculationType, amount, percentage, percentageOf } =
      basicItem.input;

    if (calculationType === StructureComponentCalculationType.FIXED) {
      return toDecimal(amount ?? 0);
    }

    if (calculationType === StructureComponentCalculationType.PERCENTAGE) {
      if (percentageOf === StructureComponentPercentageBasis.GROSS_SALARY) {
        return computePercentage(grossPeriod, percentage ?? 0);
      }
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `BASIC component cannot be calculated as percentage of '${percentageOf}'`,
        HttpStatus.BAD_REQUEST,
      );
    }

    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'BASIC component must be configured with FIXED amount or PERCENTAGE of GROSS_SALARY',
      HttpStatus.BAD_REQUEST,
    );
  }

  private evaluateComponentValue(
    input: CalculationComponentInput,
    grossPeriod: Decimal,
    basicPeriod: Decimal,
  ): Decimal {
    if (input.calculationType === StructureComponentCalculationType.FIXED) {
      return toDecimal(input.amount ?? 0);
    }

    if (
      input.calculationType === StructureComponentCalculationType.PERCENTAGE
    ) {
      const pct = input.percentage ?? 0;
      if (input.percentageOf === StructureComponentPercentageBasis.BASIC) {
        return computePercentage(basicPeriod, pct);
      }
      if (
        input.percentageOf === StructureComponentPercentageBasis.GROSS_SALARY
      ) {
        return computePercentage(grossPeriod, pct);
      }
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Unsupported percentageOf base: '${input.percentageOf}'`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return toDecimal(0);
  }

  private resolveGrossFromCtc(
    ctcPeriod: Decimal,
    basicItem: ComponentItemWithMaster | undefined,
    employerContributions: ComponentItemWithMaster[],
  ): { derivedGross: Decimal; derivedBasic: Decimal } {
    let fixedEmpCost = toDecimal(0);
    let totalGrossRate = toDecimal(0);

    // Basic parameters: is Basic fixed or percentage of Gross?
    let isBasicFixed = false;
    let basicFixedAmount = toDecimal(0);
    let basicGrossRate = toDecimal(0);

    if (basicItem) {
      if (
        basicItem.input.calculationType ===
        StructureComponentCalculationType.FIXED
      ) {
        isBasicFixed = true;
        basicFixedAmount = toDecimal(basicItem.input.amount ?? 0);
      } else if (
        basicItem.input.calculationType ===
          StructureComponentCalculationType.PERCENTAGE &&
        basicItem.input.percentageOf ===
          StructureComponentPercentageBasis.GROSS_SALARY
      ) {
        basicGrossRate = toDecimal(basicItem.input.percentage ?? 0).dividedBy(
          100,
        );
      } else {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Cannot resolve CTC: BASIC component must be FIXED or a PERCENTAGE of GROSS_SALARY when using 'CTC' salary basis.",
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    for (const contrib of employerContributions) {
      const { calculationType, amount, percentage, percentageOf } =
        contrib.input;

      if (calculationType === StructureComponentCalculationType.FIXED) {
        fixedEmpCost = fixedEmpCost.plus(toDecimal(amount ?? 0));
      } else if (
        calculationType === StructureComponentCalculationType.PERCENTAGE
      ) {
        const rate = toDecimal(percentage ?? 0).dividedBy(100);

        if (percentageOf === StructureComponentPercentageBasis.GROSS_SALARY) {
          totalGrossRate = totalGrossRate.plus(rate);
        } else if (percentageOf === StructureComponentPercentageBasis.BASIC) {
          if (!basicItem) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              `Employer contribution '${contrib.master.name}' depends on BASIC, but BASIC is not configured.`,
              HttpStatus.BAD_REQUEST,
            );
          }
          if (isBasicFixed) {
            // Rate * basicFixedAmount adds directly to fixed employer cost
            const cost = rate.times(basicFixedAmount);
            fixedEmpCost = fixedEmpCost.plus(cost);
          } else {
            // Basic is basicGrossRate * Gross -> Rate * (basicGrossRate * Gross)
            const effectiveGrossRate = rate.times(basicGrossRate);
            totalGrossRate = totalGrossRate.plus(effectiveGrossRate);
          }
        } else {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Unsupported percentageOf base for employer contribution: '${percentageOf}'`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    const divisor = toDecimal(1).plus(totalGrossRate);
    const availableForGross = ctcPeriod.minus(fixedEmpCost);

    if (availableForGross.lessThanOrEqualTo(0)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Configured fixed employer costs equal or exceed total CTC. Gross salary cannot be zero or negative.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const derivedGross = availableForGross.dividedBy(divisor);
    const derivedBasic = isBasicFixed
      ? basicFixedAmount
      : derivedGross.times(basicGrossRate);

    return { derivedGross, derivedBasic };
  }

  private buildBreakupResponse(params: {
    salaryBasis: SalaryStructureBasis;
    salaryFrequency: SalaryStructureFrequency;
    inputSalaryAmount: number;
    isAnnual: boolean;
    grossPeriod: Decimal;
    employerCostPeriod: Decimal;
    ctcPeriod: Decimal;
    totalDeductionsPeriod: Decimal;
    estimatedNetPeriod: Decimal;
    categorized: {
      earnings: ComponentItemWithMaster[];
      employeeDeductions: ComponentItemWithMaster[];
      employerContributions: ComponentItemWithMaster[];
    };
    earningsMap: Map<string, Decimal>;
    deductionsMap: Map<string, Decimal>;
    employerCostMap: Map<string, Decimal>;
    diagnostics: ComponentCalculationDiagnostic[];
  }): SalaryStructureBreakupResult {
    const {
      salaryBasis,
      salaryFrequency,
      inputSalaryAmount,
      isAnnual,
      grossPeriod,
      employerCostPeriod,
      ctcPeriod,
      totalDeductionsPeriod,
      estimatedNetPeriod,
      categorized,
      earningsMap,
      deductionsMap,
      employerCostMap,
      diagnostics,
    } = params;

    const buildLineItem = (
      item: ComponentItemWithMaster,
      map: Map<string, Decimal>,
    ): SalaryBreakupLineItem => {
      const dec = map.get(item.master._id.toString()) ?? toDecimal(0);
      let monthlyAmount: number;
      let annualAmount: number;

      if (isAnnual) {
        annualAmount = roundBankers(dec, 2);
        monthlyAmount = roundBankers(toDecimal(annualAmount).dividedBy(12), 2);
      } else {
        monthlyAmount = roundBankers(dec, 2);
        annualAmount = roundBankers(toDecimal(monthlyAmount).times(12), 2);
      }

      return {
        componentId: item.master._id.toString(),
        name: item.master.name,
        code: item.master.code,
        type:
          item.master.type === SalaryComponentType.DEDUCTION
            ? SalaryComponentType.EMPLOYEE_DEDUCTION
            : item.master.type,
        calculationType: item.input.calculationType,
        monthlyAmount,
        annualAmount,
      };
    };

    let grossMonthlyNum: number;
    let grossAnnualNum: number;
    let employerCostMonthlyNum: number;
    let employerCostAnnualNum: number;
    let ctcMonthlyNum: number;
    let ctcAnnualNum: number;
    let deductionsMonthlyNum: number;
    let deductionsAnnualNum: number;
    let netMonthlyNum: number;
    let netAnnualNum: number;

    if (isAnnual) {
      grossAnnualNum = roundBankers(grossPeriod, 2);
      grossMonthlyNum = roundBankers(
        toDecimal(grossAnnualNum).dividedBy(12),
        2,
      );
      employerCostAnnualNum = roundBankers(employerCostPeriod, 2);
      employerCostMonthlyNum = roundBankers(
        toDecimal(employerCostAnnualNum).dividedBy(12),
        2,
      );
      ctcAnnualNum = roundBankers(ctcPeriod, 2);
      ctcMonthlyNum = roundBankers(toDecimal(ctcAnnualNum).dividedBy(12), 2);
      deductionsAnnualNum = roundBankers(totalDeductionsPeriod, 2);
      deductionsMonthlyNum = roundBankers(
        toDecimal(deductionsAnnualNum).dividedBy(12),
        2,
      );
      netAnnualNum = roundBankers(estimatedNetPeriod, 2);
      netMonthlyNum = roundBankers(toDecimal(netAnnualNum).dividedBy(12), 2);
    } else {
      grossMonthlyNum = roundBankers(grossPeriod, 2);
      grossAnnualNum = roundBankers(toDecimal(grossMonthlyNum).times(12), 2);
      employerCostMonthlyNum = roundBankers(employerCostPeriod, 2);
      employerCostAnnualNum = roundBankers(
        toDecimal(employerCostMonthlyNum).times(12),
        2,
      );
      ctcMonthlyNum = roundBankers(ctcPeriod, 2);
      ctcAnnualNum = roundBankers(toDecimal(ctcMonthlyNum).times(12), 2);
      deductionsMonthlyNum = roundBankers(totalDeductionsPeriod, 2);
      deductionsAnnualNum = roundBankers(
        toDecimal(deductionsMonthlyNum).times(12),
        2,
      );
      netMonthlyNum = roundBankers(estimatedNetPeriod, 2);
      netAnnualNum = roundBankers(toDecimal(netMonthlyNum).times(12), 2);
    }

    if (isAnnual) {
      grossAnnualNum = roundBankers(grossPeriod, 2);
      grossMonthlyNum = roundBankers(
        toDecimal(grossAnnualNum).dividedBy(12),
        2,
      );
      employerCostAnnualNum = roundBankers(employerCostPeriod, 2);
      employerCostMonthlyNum = roundBankers(
        toDecimal(employerCostAnnualNum).dividedBy(12),
        2,
      );
      ctcAnnualNum = roundBankers(ctcPeriod, 2);
      ctcMonthlyNum = roundBankers(toDecimal(ctcAnnualNum).dividedBy(12), 2);
      deductionsAnnualNum = roundBankers(totalDeductionsPeriod, 2);
      deductionsMonthlyNum = roundBankers(
        toDecimal(deductionsAnnualNum).dividedBy(12),
        2,
      );
      netAnnualNum = roundBankers(estimatedNetPeriod, 2);
      netMonthlyNum = roundBankers(toDecimal(netAnnualNum).dividedBy(12), 2);
    } else {
      grossMonthlyNum = roundBankers(grossPeriod, 2);
      grossAnnualNum = roundBankers(toDecimal(grossMonthlyNum).times(12), 2);
      employerCostMonthlyNum = roundBankers(employerCostPeriod, 2);
      employerCostAnnualNum = roundBankers(
        toDecimal(employerCostMonthlyNum).times(12),
        2,
      );
      ctcMonthlyNum = roundBankers(ctcPeriod, 2);
      ctcAnnualNum = roundBankers(toDecimal(ctcMonthlyNum).times(12), 2);
      deductionsMonthlyNum = roundBankers(totalDeductionsPeriod, 2);
      deductionsAnnualNum = roundBankers(
        toDecimal(deductionsMonthlyNum).times(12),
        2,
      );
      netMonthlyNum = roundBankers(estimatedNetPeriod, 2);
      netAnnualNum = roundBankers(toDecimal(netMonthlyNum).times(12), 2);
    }

    return {
      salaryBasis,
      salaryFrequency,
      inputSalaryAmount,
      grossSalaryMonthly: grossMonthlyNum,
      grossSalaryAnnual: grossAnnualNum,
      totalEmployerContributionsMonthly: employerCostMonthlyNum,
      totalEmployerContributionsAnnual: employerCostAnnualNum,
      totalCtcMonthly: ctcMonthlyNum,
      totalCtcAnnual: ctcAnnualNum,
      totalEmployeeDeductionsMonthly: deductionsMonthlyNum,
      totalEmployeeDeductionsAnnual: deductionsAnnualNum,
      estimatedNetSalaryMonthly: netMonthlyNum,
      estimatedNetSalaryAnnual: netAnnualNum,
      summary: {
        monthly: {
          grossSalary: grossMonthlyNum,
          employerContributions: employerCostMonthlyNum,
          totalCtc: ctcMonthlyNum,
          employeeDeductions: deductionsMonthlyNum,
          estimatedNetSalary: netMonthlyNum,
        },
        annual: {
          grossSalary: grossAnnualNum,
          employerContributions: employerCostAnnualNum,
          totalCtc: ctcAnnualNum,
          employeeDeductions: deductionsAnnualNum,
          estimatedNetSalary: netAnnualNum,
        },
      },
      earnings: categorized.earnings.map((e) => buildLineItem(e, earningsMap)),
      employeeDeductions: categorized.employeeDeductions.map((d) =>
        buildLineItem(d, deductionsMap),
      ),
      employerContributions: categorized.employerContributions.map((c) =>
        buildLineItem(c, employerCostMap),
      ),
      diagnostics,
    };
  }
}

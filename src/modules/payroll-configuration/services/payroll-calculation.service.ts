import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SalaryComponent,
  SalaryComponentDocument,
  SalaryComponentLean,
} from '../../salary-components/schemas/salary-component.schema';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { PayrollSettingsRepository } from '../repositories/payroll-settings.repository';
import { PayrollCalculationRuleRepository } from '../repositories/payroll-calculation-rule.repository';
import {
  CalculatePayrollPreviewDto,
  PayrollPreviewCalculationType,
  PayrollPreviewComponentInputDto,
} from '../dto/calculate-payroll-preview.dto';
import {
  NegativeNetPayPolicy,
  PAYROLL_CONFIGURATION_DEFAULTS,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../constants/payroll-configuration.constant';
import {
  computePercentage,
  Decimal,
  toDecimal,
} from '../../../common/utils/financial-math.util';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';

export interface PayrollPreviewLineItem {
  componentId: string;
  code: string;
  name: string;
  type: SalaryComponentType;
  calculationType: PayrollPreviewCalculationType;
  percentageOf: string | null;
  percentage: number | null;
  baseAmount: number | null;
  prorated: boolean;
  calculatedAmount: number;
}

export interface PayrollPreviewResult {
  currency: string;
  roundingMode: PayrollRoundingMode;
  roundingPrecision: number;
  proration: {
    applied: boolean;
    policy: PayrollProrationPolicy;
    totalDaysInPeriod: number | null;
    payableDays: number | null;
    factor: number;
  };
  executionOrder: string[];
  earnings: PayrollPreviewLineItem[];
  deductions: PayrollPreviewLineItem[];
  employerContributions: PayrollPreviewLineItem[];
  summary: {
    grossEarnings: number;
    totalDeductions: number;
    employerContributions: number;
    netSalary: number;
    netPayClamped: boolean;
  };
}

interface ResolvedComponentNode {
  input: PayrollPreviewComponentInputDto;
  master: SalaryComponentLean;
  code: string;
  normalizedType: SalaryComponentType;
  resolvedAmountValue?: number;
  resolvedPercentage?: number;
  resolvedPercentageOf?: string | null;
  dependencies: string[];
}

const AGGREGATE_GROSS_BASES = new Set(['GROSS_EARNINGS', 'GROSS_SALARY']);

@Injectable()
export class PayrollCalculationService {
  constructor(
    @InjectModel(SalaryComponent.name)
    private readonly salaryComponentModel: Model<SalaryComponentDocument>,
    private readonly settingsRepository: PayrollSettingsRepository,
    private readonly ruleRepository: PayrollCalculationRuleRepository,
  ) {}

  async calculatePreview(
    dto: CalculatePayrollPreviewDto,
  ): Promise<PayrollPreviewResult> {
    if (!dto.components || dto.components.length === 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'At least one component is required for payroll calculation preview.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const [settingsDoc, ruleDoc] = await Promise.all([
      this.settingsRepository.findActive(),
      this.ruleRepository.findActive(),
    ]);

    const currency =
      settingsDoc?.currency ?? PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY;
    const roundingMode =
      ruleDoc?.roundingMode ?? PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_MODE;
    const roundingPrecision =
      ruleDoc?.roundingPrecision ??
      PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_PRECISION;
    const prorationPolicy =
      ruleDoc?.prorationPolicy ??
      PAYROLL_CONFIGURATION_DEFAULTS.PRORATION_POLICY;
    const prorateFixedComponents =
      ruleDoc?.prorateFixedComponents ??
      PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_FIXED_COMPONENTS;
    const prorateDeductions =
      ruleDoc?.prorateDeductions ??
      PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_DEDUCTIONS;
    const negativeNetPayPolicy =
      ruleDoc?.negativeNetPayPolicy ??
      PAYROLL_CONFIGURATION_DEFAULTS.NEGATIVE_NET_PAY_POLICY;
    const configuredOrder = ruleDoc?.componentExecutionOrder ?? [];

    // 1. Validate proration inputs if provided
    let prorationApplied = false;
    let totalDaysInPeriod: number | null = null;
    let payableDays: number | null = null;
    let prorationFactor = toDecimal(1);

    if (dto.payableDays !== undefined || dto.totalDaysInPeriod !== undefined) {
      totalDaysInPeriod =
        prorationPolicy === PayrollProrationPolicy.FIXED_30_DAYS
          ? (dto.totalDaysInPeriod ?? 30)
          : prorationPolicy === PayrollProrationPolicy.WORKING_DAYS &&
              settingsDoc?.fixedWorkingDaysPerMonth
            ? (dto.totalDaysInPeriod ?? settingsDoc.fixedWorkingDaysPerMonth)
            : (dto.totalDaysInPeriod ?? 30);

      payableDays = dto.payableDays ?? totalDaysInPeriod;

      if (totalDaysInPeriod <= 0) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `totalDaysInPeriod (${totalDaysInPeriod}) must be greater than 0.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      if (payableDays < 0 || payableDays > totalDaysInPeriod) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `payableDays (${payableDays}) must be between 0 and totalDaysInPeriod (${totalDaysInPeriod}).`,
          HttpStatus.BAD_REQUEST,
        );
      }

      prorationFactor = toDecimal(payableDays).dividedBy(totalDaysInPeriod);
      prorationApplied = !prorationFactor.equals(1);
    }

    // 2. Reject duplicate componentId entries
    const seenIds = new Set<string>();
    const componentObjectIds: Types.ObjectId[] = [];
    for (const item of dto.components) {
      if (seenIds.has(item.componentId)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Duplicate componentId '${item.componentId}' in calculation preview.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      seenIds.add(item.componentId);
      componentObjectIds.push(new Types.ObjectId(item.componentId));
    }

    // 3. Batch fetch authoritative master components
    const masterDocs = await this.salaryComponentModel
      .find({ _id: { $in: componentObjectIds } })
      .lean<SalaryComponentLean[]>()
      .exec();

    const masterById = new Map<string, SalaryComponentLean>();
    for (const doc of masterDocs) {
      masterById.set(doc._id.toString(), doc);
    }

    // 4. Build graph nodes & validate master status and component parameters
    const nodes: ResolvedComponentNode[] = [];
    const nodeByCode = new Map<string, ResolvedComponentNode>();

    for (const input of dto.components) {
      const master = masterById.get(input.componentId);
      if (!master) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Referenced SalaryComponent '${input.componentId}' not found.`,
          HttpStatus.NOT_FOUND,
        );
      }
      if (!master.isActive) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Inactive salary component '${master.name}' (${master.code}) cannot be used in calculations.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const code = master.code.trim().toUpperCase();
      if (!Object.values(SalaryComponentType).includes(master.type)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid component category/type '${master.type}' for component '${code}'.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const normalizedType =
        master.type === SalaryComponentType.DEDUCTION
          ? SalaryComponentType.EMPLOYEE_DEDUCTION
          : master.type;

      if (
        input.calculationType !== PayrollPreviewCalculationType.FIXED &&
        input.calculationType !== PayrollPreviewCalculationType.PERCENTAGE
      ) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Unsupported calculationType '${String(input.calculationType)}' for component '${code}'.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      let resolvedAmountValue: number | undefined;
      let resolvedPercentage: number | undefined;
      let resolvedPercentageOf: string | null = null;

      if (input.calculationType === PayrollPreviewCalculationType.FIXED) {
        if (input.percentageOf !== undefined && input.percentageOf !== null) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `percentageOf is not allowed for FIXED component '${code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        if (input.percentage !== undefined && input.percentage !== null) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `percentage is not allowed for FIXED component '${code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        const effectiveAmount = input.amount ?? master.defaultValue ?? null;
        if (
          effectiveAmount === null ||
          effectiveAmount === undefined ||
          !Number.isFinite(effectiveAmount) ||
          effectiveAmount < 0
        ) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Valid non-negative amount is required for FIXED component '${code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        resolvedAmountValue = effectiveAmount;
      } else {
        if (input.amount !== undefined && input.amount !== null) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `amount is not allowed for PERCENTAGE component '${code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        const effectivePct = input.percentage ?? master.defaultValue ?? null;
        if (
          effectivePct === null ||
          effectivePct === undefined ||
          !Number.isFinite(effectivePct) ||
          effectivePct < 0 ||
          effectivePct > 100
        ) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Valid percentage (0-100) is required for PERCENTAGE component '${code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        const effectiveBase = (input.percentageOf ?? master.percentageOf ?? '')
          .trim()
          .toUpperCase();
        if (!effectiveBase) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `percentageOf base is required for PERCENTAGE component '${code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        resolvedPercentage = effectivePct;
        resolvedPercentageOf = effectiveBase;
      }

      const node: ResolvedComponentNode = {
        input,
        master,
        code,
        normalizedType,
        resolvedAmountValue,
        resolvedPercentage,
        resolvedPercentageOf,
        dependencies: [],
      };
      nodes.push(node);
      nodeByCode.set(code, node);
    }

    // 5. Resolve dependencies and validate missing bases / circular dependencies
    const earningCodes = nodes
      .filter((n) => n.normalizedType === SalaryComponentType.EARNING)
      .map((n) => n.code);

    for (const node of nodes) {
      if (
        node.input.calculationType !== PayrollPreviewCalculationType.PERCENTAGE
      ) {
        continue;
      }
      const base = node.resolvedPercentageOf!;

      if (AGGREGATE_GROSS_BASES.has(base)) {
        if (node.normalizedType === SalaryComponentType.EARNING) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Circular calculation dependency: earning component '${node.code}' cannot depend on '${base}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        // Non-earning components depending on GROSS depend on all earning components
        node.dependencies = [...earningCodes];
      } else if (base === 'BASIC_AND_DA') {
        if (!nodeByCode.has('BASIC')) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Missing percentage base component 'BASIC' required by '${node.code}' (BASIC_AND_DA).`,
            HttpStatus.BAD_REQUEST,
          );
        }
        node.dependencies = ['BASIC'];
        if (nodeByCode.has('DA')) {
          node.dependencies.push('DA');
        }
      } else {
        if (!nodeByCode.has(base)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Missing percentage base component '${base}' required by '${node.code}'.`,
            HttpStatus.BAD_REQUEST,
          );
        }
        node.dependencies = [base];
      }
    }

    // 6. Topological sort with explicit execution order preference and DFS cycle detection
    const executionNodes = this.topologicalSort(
      nodes,
      nodeByCode,
      configuredOrder,
    );

    // 7. Evaluate components in dependency order using Decimal arithmetic
    const resolvedAmounts = new Map<string, Decimal>();
    const lineItemsByCode = new Map<string, PayrollPreviewLineItem>();
    let runningGrossEarnings = toDecimal(0);

    // Evaluate all earning components (and any non-gross dependencies) first;
    // topological sort guarantees every component's dependencies are resolved first.
    const earnings: PayrollPreviewLineItem[] = [];
    const deductions: PayrollPreviewLineItem[] = [];
    const employerContributions: PayrollPreviewLineItem[] = [];

    for (const node of executionNodes) {
      let baseDec: Decimal | null = null;
      let rawAmount: Decimal;
      let prorated = false;

      if (node.input.calculationType === PayrollPreviewCalculationType.FIXED) {
        rawAmount = toDecimal(node.resolvedAmountValue!);
        if (prorationApplied) {
          if (
            node.normalizedType === SalaryComponentType.EARNING &&
            prorateFixedComponents
          ) {
            rawAmount = rawAmount.times(prorationFactor);
            prorated = true;
          } else if (
            node.normalizedType === SalaryComponentType.EMPLOYEE_DEDUCTION &&
            prorateDeductions
          ) {
            rawAmount = rawAmount.times(prorationFactor);
            prorated = true;
          }
        }
      } else {
        const base = node.resolvedPercentageOf!;
        if (AGGREGATE_GROSS_BASES.has(base)) {
          // All earning nodes appear before any node that depends on GROSS
          baseDec = runningGrossEarnings;
        } else if (base === 'BASIC_AND_DA') {
          const basicVal = resolvedAmounts.get('BASIC') ?? toDecimal(0);
          const daVal = resolvedAmounts.get('DA') ?? toDecimal(0);
          baseDec = basicVal.plus(daVal);
        } else {
          baseDec = resolvedAmounts.get(base) ?? toDecimal(0);
        }

        rawAmount = computePercentage(baseDec, node.resolvedPercentage!);
        if (
          prorationApplied &&
          node.normalizedType === SalaryComponentType.EMPLOYEE_DEDUCTION &&
          prorateDeductions &&
          !AGGREGATE_GROSS_BASES.has(base)
        ) {
          // Prorate deduction if not already computed on prorated gross
          const baseNode = nodeByCode.get(base);
          const baseWasProrated = baseNode
            ? (lineItemsByCode.get(base)?.prorated ?? false)
            : false;
          if (!baseWasProrated) {
            rawAmount = rawAmount.times(prorationFactor);
            prorated = true;
          }
        }
      }

      const roundedNum = this.roundWithRule(
        rawAmount,
        roundingPrecision,
        roundingMode,
      );
      const roundedDec = toDecimal(roundedNum);
      resolvedAmounts.set(node.code, roundedDec);

      if (node.normalizedType === SalaryComponentType.EARNING) {
        runningGrossEarnings = runningGrossEarnings.plus(roundedDec);
      }

      const lineItem: PayrollPreviewLineItem = {
        componentId: node.master._id.toString(),
        code: node.code,
        name: node.master.name,
        type: node.normalizedType,
        calculationType: node.input.calculationType,
        percentageOf: node.resolvedPercentageOf ?? null,
        percentage: node.resolvedPercentage ?? null,
        baseAmount:
          baseDec !== null
            ? this.roundWithRule(baseDec, roundingPrecision, roundingMode)
            : null,
        prorated,
        calculatedAmount: roundedNum,
      };

      lineItemsByCode.set(node.code, lineItem);

      if (node.normalizedType === SalaryComponentType.EARNING) {
        earnings.push(lineItem);
      } else if (
        node.normalizedType === SalaryComponentType.EMPLOYEE_DEDUCTION
      ) {
        deductions.push(lineItem);
      } else {
        employerContributions.push(lineItem);
      }
    }

    // 8. Authoritative summary totals:
    // Gross Earnings = Sum(Earnings)
    // Total Deductions = Sum(Deductions)
    // Net Salary = Gross Earnings - Total Deductions
    const grossDec = earnings.reduce(
      (sum, item) => sum.plus(toDecimal(item.calculatedAmount)),
      toDecimal(0),
    );
    const deductionsDec = deductions.reduce(
      (sum, item) => sum.plus(toDecimal(item.calculatedAmount)),
      toDecimal(0),
    );
    const employerDec = employerContributions.reduce(
      (sum, item) => sum.plus(toDecimal(item.calculatedAmount)),
      toDecimal(0),
    );

    const grossEarnings = this.roundWithRule(
      grossDec,
      roundingPrecision,
      roundingMode,
    );
    const totalDeductions = this.roundWithRule(
      deductionsDec,
      roundingPrecision,
      roundingMode,
    );
    const totalEmployerContributions = this.roundWithRule(
      employerDec,
      roundingPrecision,
      roundingMode,
    );

    const netDec = toDecimal(grossEarnings).minus(toDecimal(totalDeductions));
    let netSalary = this.roundWithRule(netDec, roundingPrecision, roundingMode);
    let netPayClamped = false;

    if (netSalary < 0) {
      if (negativeNetPayPolicy === NegativeNetPayPolicy.REJECT) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Total deductions (${totalDeductions}) exceed gross earnings (${grossEarnings}), resulting in negative net salary (${netSalary}).`,
          HttpStatus.BAD_REQUEST,
        );
      }
      netSalary = 0;
      netPayClamped = true;
    }

    return {
      currency,
      roundingMode,
      roundingPrecision,
      proration: {
        applied: prorationApplied,
        policy: prorationPolicy,
        totalDaysInPeriod,
        payableDays,
        factor: prorationFactor.toDecimalPlaces(6).toNumber(),
      },
      executionOrder: executionNodes.map((n) => n.code),
      earnings,
      deductions,
      employerContributions,
      summary: {
        grossEarnings,
        totalDeductions,
        employerContributions: totalEmployerContributions,
        netSalary,
        netPayClamped,
      },
    };
  }

  private topologicalSort(
    nodes: ResolvedComponentNode[],
    nodeByCode: Map<string, ResolvedComponentNode>,
    configuredOrder: string[],
  ): ResolvedComponentNode[] {
    const orderRank = new Map<string, number>();
    configuredOrder.forEach((code, idx) => {
      orderRank.set(code.toUpperCase(), idx);
    });

    // Prioritize earnings before non-earnings, then configured execution order, then input order
    const prioritized = [...nodes].sort((a, b) => {
      const aEarn = a.normalizedType === SalaryComponentType.EARNING ? 0 : 1;
      const bEarn = b.normalizedType === SalaryComponentType.EARNING ? 0 : 1;
      if (aEarn !== bEarn) return aEarn - bEarn;

      const aRank = orderRank.get(a.code) ?? Number.MAX_SAFE_INTEGER;
      const bRank = orderRank.get(b.code) ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    });

    const state = new Map<string, 'visiting' | 'visited'>();
    const sorted: ResolvedComponentNode[] = [];

    const visit = (node: ResolvedComponentNode, trail: string[]): void => {
      const currentState = state.get(node.code);
      if (currentState === 'visited') return;
      if (currentState === 'visiting') {
        const cycleStart = trail.indexOf(node.code);
        const cyclePath = [...trail.slice(cycleStart), node.code].join(' -> ');
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Circular calculation dependency detected: ${cyclePath}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      state.set(node.code, 'visiting');
      for (const depCode of node.dependencies) {
        const depNode = nodeByCode.get(depCode);
        if (depNode) {
          visit(depNode, [...trail, node.code]);
        }
      }
      state.set(node.code, 'visited');
      sorted.push(node);
    };

    for (const node of prioritized) {
      if (!state.has(node.code)) {
        visit(node, []);
      }
    }

    return sorted;
  }

  private roundWithRule(
    value: Decimal,
    precision: number,
    mode: PayrollRoundingMode,
  ): number {
    const decimalRoundingMap: Record<PayrollRoundingMode, Decimal.Rounding> = {
      [PayrollRoundingMode.HALF_EVEN]: Decimal.ROUND_HALF_EVEN,
      [PayrollRoundingMode.HALF_UP]: Decimal.ROUND_HALF_UP,
      [PayrollRoundingMode.HALF_DOWN]: Decimal.ROUND_HALF_DOWN,
      [PayrollRoundingMode.FLOOR]: Decimal.ROUND_FLOOR,
      [PayrollRoundingMode.CEIL]: Decimal.ROUND_CEIL,
    };

    return value
      .toDecimalPlaces(precision, decimalRoundingMap[mode])
      .toNumber();
  }
}

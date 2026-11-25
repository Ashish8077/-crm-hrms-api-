import { PayrollSettingsLean } from '../schemas/payroll-settings.schema';
import {
  PayrollCalculationRuleLean,
  StatutoryCalculationFlags,
} from '../schemas/payroll-calculation-rule.schema';
import {
  NegativeNetPayPolicy,
  PayrollFrequency,
  PayrollProrationPolicy,
  PayrollRoundingMode,
  WorkingDaysPolicy,
} from '../constants/payroll-configuration.constant';

export interface PayrollSettingsResponse {
  id: string;
  currency: string;
  currencyPrecision: number;
  payrollFrequency: PayrollFrequency;
  cutoffDay: number;
  paymentDay: number;
  financialYearStartMonth: number;
  workingDaysPolicy: WorkingDaysPolicy;
  fixedWorkingDaysPerMonth: number | null;
  isPayrollProcessingEnabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayrollCalculationRuleResponse {
  id: string;
  roundingMode: PayrollRoundingMode;
  roundingPrecision: number;
  prorationPolicy: PayrollProrationPolicy;
  prorateFixedComponents: boolean;
  prorateDeductions: boolean;
  negativeNetPayPolicy: NegativeNetPayPolicy;
  statutoryConfig: StatutoryCalculationFlags;
  componentExecutionOrder: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class PayrollConfigurationMapper {
  static toSettingsResponse(
    settings: PayrollSettingsLean,
  ): PayrollSettingsResponse {
    return {
      id: settings._id.toString(),
      currency: settings.currency,
      currencyPrecision: settings.currencyPrecision,
      payrollFrequency: settings.payrollFrequency,
      cutoffDay: settings.cutoffDay,
      paymentDay: settings.paymentDay,
      financialYearStartMonth: settings.financialYearStartMonth,
      workingDaysPolicy: settings.workingDaysPolicy,
      fixedWorkingDaysPerMonth: settings.fixedWorkingDaysPerMonth ?? null,
      isPayrollProcessingEnabled: settings.isPayrollProcessingEnabled,
      version: settings.__v ?? 0,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  static toCalculationRuleResponse(
    rule: PayrollCalculationRuleLean,
  ): PayrollCalculationRuleResponse {
    return {
      id: rule._id.toString(),
      roundingMode: rule.roundingMode,
      roundingPrecision: rule.roundingPrecision,
      prorationPolicy: rule.prorationPolicy,
      prorateFixedComponents: rule.prorateFixedComponents,
      prorateDeductions: rule.prorateDeductions,
      negativeNetPayPolicy: rule.negativeNetPayPolicy,
      statutoryConfig: {
        pfEnabled: rule.statutoryConfig.pfEnabled,
        esiEnabled: rule.statutoryConfig.esiEnabled,
        ptEnabled: rule.statutoryConfig.ptEnabled,
        tdsEnabled: rule.statutoryConfig.tdsEnabled,
      },
      componentExecutionOrder: rule.componentExecutionOrder ?? [],
      version: rule.__v ?? 0,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }
}

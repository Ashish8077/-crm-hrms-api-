import { Injectable } from '@nestjs/common';
import {
  PAYROLL_CALCULATION_ENGINE_VERSION,
  toDecimal128,
} from '../constants/payroll-calculation.constant';
import {
  PayrollCalculationSnapshot,
  PayrollSnapshotComponentItem,
} from '../schemas/payroll-record.schema';
import { ResolvedPayrollInputs } from './payroll-input.resolver';
import {
  ProratedComponentResult,
  ProrationResult,
} from './proration.calculator';
import { PayrollTotalsResult } from './payroll-totals.calculator';

function formatDateOnly(date: Date): string {
  return date instanceof Date ? date.toISOString().slice(0, 10) : String(date);
}

@Injectable()
export class PayrollSnapshotBuilder {
  build(params: {
    inputs: ResolvedPayrollInputs;
    executionOrder: string[];
    proration: ProrationResult;
    totals: PayrollTotalsResult;
    calculatedAt: Date;
  }): PayrollCalculationSnapshot {
    const { inputs, executionOrder, proration, totals, calculatedAt } = params;
    const {
      period,
      employee,
      salaryAssignment,
      salaryStructure,
      configuration,
    } = inputs;
    const precision = configuration.roundingPrecision;

    const mapComponent = (
      item: ProratedComponentResult,
    ): PayrollSnapshotComponentItem => ({
      componentId: item.componentId,
      componentCode: item.componentCode,
      componentName: item.componentName,
      classification: item.classification,
      calculationMethod: item.calculationMethod,
      percentage: item.percentage,
      percentageOf: item.percentageOf,
      monthlyBaseAmount: toDecimal128(item.monthlyBaseAmountDec, precision),
      monthlyCalculatedAmount: toDecimal128(
        item.monthlyCalculatedAmountDec,
        precision,
      ),
      prorationApplied: item.prorationApplied,
      payableDays: item.payableDays,
      calendarDays: item.calendarDays,
      finalAmount: toDecimal128(item.finalAmountDec, precision),
    });

    return {
      engineVersion: PAYROLL_CALCULATION_ENGINE_VERSION,
      calculatedAt,
      payrollPeriodId: period._id.toString(),
      periodCode: period.periodCode,
      periodName: period.periodName,
      payrollFrequency: period.payrollFrequency,
      startDate: formatDateOnly(period.startDate),
      endDate: formatDateOnly(period.endDate),
      month: period.month,
      year: period.year,
      employeeId: employee._id.toString(),
      employeeCode: employee.employeeCode,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      employmentStatus: employee.employmentStatus,
      salaryAssignmentId: salaryAssignment._id.toString(),
      salaryAssignmentVersion: salaryAssignment.__v ?? 0,
      salaryAssignmentEffectiveFrom: formatDateOnly(
        salaryAssignment.effectiveFrom,
      ),
      salaryAssignmentEffectiveTo: salaryAssignment.effectiveTo
        ? formatDateOnly(salaryAssignment.effectiveTo)
        : null,
      salaryStructureId: salaryStructure._id.toString(),
      salaryStructureCode: salaryStructure.code,
      salaryStructureName: salaryStructure.name,
      salaryStructureVersion:
        salaryStructure.__v ?? salaryAssignment.salaryStructureVersion,
      salaryBasis: salaryStructure.salaryBasis,
      salaryFrequency: salaryStructure.salaryFrequency,
      payrollSettingsId: configuration.payrollSettingsId,
      payrollSettingsVersion: configuration.payrollSettingsVersion,
      payrollCalculationRuleId: configuration.payrollCalculationRuleId,
      payrollCalculationRuleVersion:
        configuration.payrollCalculationRuleVersion,
      currency: configuration.currency,
      roundingMode: configuration.roundingMode,
      roundingPrecision: precision,
      prorationPolicy: configuration.prorationPolicy,
      prorateFixedComponents: configuration.prorateFixedComponents,
      prorateDeductions: configuration.prorateDeductions,
      prorateEmployerContributions: configuration.prorateEmployerContributions,
      negativeNetPayPolicy: configuration.negativeNetPayPolicy,
      calendarDays: proration.calendarDays,
      prorationDenominatorDays: proration.prorationDenominatorDays,
      payableDays: proration.payableDays,
      prorationApplied: proration.prorationApplied,
      prorationFactor: proration.prorationFactor.toDecimalPlaces(10).toString(),
      executionOrder,
      earnings: totals.earnings.map(mapComponent),
      deductions: totals.deductions.map(mapComponent),
      employerContributions: totals.employerContributions.map(mapComponent),
      grossEarnings: toDecimal128(totals.grossEarningsDec, precision),
      totalDeductions: toDecimal128(totals.totalDeductionsDec, precision),
      employerContributionsTotal: toDecimal128(
        totals.employerContributionsDec,
        precision,
      ),
      netSalary: toDecimal128(totals.netSalaryDec, precision),
      netPayClamped: totals.netPayClamped,
    };
  }
}

import { createHash } from 'node:crypto';
import { PAYROLL_CALCULATION_ENGINE_VERSION } from '../constants/payroll-calculation.constant';
import type { ResolvedPayrollInputs } from '../services/payroll-input.resolver';
import type { ResolvedStructureComponents } from '../services/salary-component.resolver';

function toIsoDateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Computes a deterministic SHA-256 fingerprint over all observable payroll-critical inputs
 * so retries, completion checks, and finalization checks reliably detect stale PayrollRecords.
 */
export function computePayrollInputFingerprint(
  inputs: ResolvedPayrollInputs,
  resolvedComponents: ResolvedStructureComponents,
): string {
  const {
    period,
    employee,
    salaryAssignment,
    salaryStructure,
    configuration,
    leaveAndAttendance,
    calendarDays,
    payableDays,
  } = inputs;

  const masterComponentsDigest = Object.values(resolvedComponents.masterMap)
    .map((m) => ({
      id: m._id.toString(),
      code: m.code,
      type: m.type,
      isActive: m.isActive,
      updatedAt:
        m.updatedAt instanceof Date
          ? m.updatedAt.toISOString()
          : String(m.updatedAt ?? ''),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const structureComponentsDigest = salaryStructure.components.map((c) => ({
    componentId: c.componentId.toString(),
    calculationType: c.calculationType,
    amount: c.amount ?? null,
    percentage: c.percentage ?? null,
    percentageOf: c.percentageOf ?? null,
  }));

  const payload = {
    engineVersion: PAYROLL_CALCULATION_ENGINE_VERSION,
    period: {
      id: period._id.toString(),
      startDate: toIsoDateOnly(period.startDate),
      endDate: toIsoDateOnly(period.endDate),
      payrollFrequency: period.payrollFrequency,
    },
    employee: {
      id: employee._id.toString(),
      branchId: employee.branchId ? employee.branchId.toString() : null,
      employmentStatus: employee.employmentStatus,
      dateOfJoining: toIsoDateOnly(employee.dateOfJoining),
      lastWorkingDate: toIsoDateOnly(employee.lastWorkingDate),
      terminationDate: toIsoDateOnly(employee.terminationDate),
    },
    salaryAssignment: {
      id: salaryAssignment._id.toString(),
      version: salaryAssignment.__v ?? 0,
      salaryStructureId: salaryAssignment.salaryStructureId.toString(),
      effectiveFrom: toIsoDateOnly(salaryAssignment.effectiveFrom),
      effectiveTo: toIsoDateOnly(salaryAssignment.effectiveTo),
      salaryBasis: salaryAssignment.salaryBasis,
      salaryFrequency: salaryAssignment.salaryFrequency,
      salaryAmount: salaryAssignment.salaryAmount,
      status: salaryAssignment.status,
    },
    salaryStructure: {
      id: salaryStructure._id.toString(),
      version: salaryStructure.__v ?? 0,
      salaryBasis: salaryStructure.salaryBasis,
      salaryFrequency: salaryStructure.salaryFrequency,
      salaryAmount: salaryStructure.salaryAmount,
      components: structureComponentsDigest,
      masterComponents: masterComponentsDigest,
    },
    configuration: {
      payrollSettingsId: configuration.payrollSettingsId,
      payrollSettingsVersion: configuration.payrollSettingsVersion,
      payrollCalculationRuleId: configuration.payrollCalculationRuleId,
      payrollCalculationRuleVersion:
        configuration.payrollCalculationRuleVersion,
      currency: configuration.currency,
      roundingMode: configuration.roundingMode,
      roundingPrecision: configuration.roundingPrecision,
      prorationPolicy: configuration.prorationPolicy,
      prorateFixedComponents: configuration.prorateFixedComponents,
      prorateDeductions: configuration.prorateDeductions,
      prorateEmployerContributions: configuration.prorateEmployerContributions,
      negativeNetPayPolicy: configuration.negativeNetPayPolicy,
      fixedWorkingDaysPerMonth: configuration.fixedWorkingDaysPerMonth,
      componentExecutionOrder: configuration.componentExecutionOrder,
    },
    leaveAndAttendance: {
      calendarDays,
      payableDays,
      tenureCalendarDays: leaveAndAttendance.tenureCalendarDays,
      eligibleWorkingDays: leaveAndAttendance.eligibleWorkingDays,
      weeklyOffDays: leaveAndAttendance.weeklyOffDays,
      holidayDays: leaveAndAttendance.holidayDays,
      presentDays: leaveAndAttendance.presentDays,
      halfDays: leaveAndAttendance.halfDays,
      paidLeaveDays: leaveAndAttendance.paidLeaveDays,
      unpaidLeaveDays: leaveAndAttendance.unpaidLeaveDays,
      unpaidLeaveLopDays: leaveAndAttendance.unpaidLeaveLopDays,
      attendanceAbsenceDays: leaveAndAttendance.attendanceAbsenceDays,
      attendanceAbsenceLopDays: leaveAndAttendance.attendanceAbsenceLopDays,
      halfDayDeductions: leaveAndAttendance.halfDayDeductions,
      totalLopDays: leaveAndAttendance.totalLopDays,
      pendingCancellationLeaveDays:
        leaveAndAttendance.pendingCancellationLeaveDays,
      leaveTypeBreakdown: leaveAndAttendance.leaveTypeBreakdown,
      warnings: leaveAndAttendance.warnings,
      leaveAttendanceMismatchDates:
        leaveAndAttendance.leaveAttendanceMismatchDates,
      overlappingLeaveDates: leaveAndAttendance.overlappingLeaveDates,
      conflictingLeaveDates: leaveAndAttendance.conflictingLeaveDates,
    },
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

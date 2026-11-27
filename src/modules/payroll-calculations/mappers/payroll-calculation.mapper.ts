import { decimal128ToString } from '../constants/payroll-calculation.constant';
import { PAYROLL_CONFIGURATION_DEFAULTS } from '../../payroll-configuration/constants/payroll-configuration.constant';
import {
  PayrollCalculationSnapshot,
  PayrollRecordLean,
  PayrollSnapshotComponentItem,
} from '../schemas/payroll-record.schema';
import {
  PayrollCalculationPreviewResponseDto,
  PayrollCalculationSnapshotResponseDto,
  PayrollRecordResponseDto,
  PayrollSnapshotComponentResponseDto,
} from '../dto/payroll-calculation-response.dto';

export class PayrollCalculationMapper {
  static mapComponentItem(
    item: PayrollSnapshotComponentItem,
  ): PayrollSnapshotComponentResponseDto {
    return {
      componentId: item.componentId,
      componentCode: item.componentCode,
      componentName: item.componentName,
      classification: item.classification,
      calculationMethod: item.calculationMethod,
      percentage: item.percentage,
      percentageOf: item.percentageOf,
      monthlyBaseAmount: decimal128ToString(item.monthlyBaseAmount),
      monthlyCalculatedAmount: decimal128ToString(item.monthlyCalculatedAmount),
      prorationApplied: item.prorationApplied,
      payableDays: item.payableDays,
      calendarDays: item.calendarDays,
      finalAmount: decimal128ToString(item.finalAmount),
    };
  }

  static mapSnapshot(
    snapshot: PayrollCalculationSnapshot,
  ): PayrollCalculationSnapshotResponseDto {
    return {
      engineVersion: snapshot.engineVersion,
      calculatedAt:
        snapshot.calculatedAt instanceof Date
          ? snapshot.calculatedAt.toISOString()
          : String(snapshot.calculatedAt),
      payrollPeriodId: snapshot.payrollPeriodId,
      periodCode: snapshot.periodCode,
      periodName: snapshot.periodName,
      payrollFrequency: snapshot.payrollFrequency,
      startDate: snapshot.startDate,
      endDate: snapshot.endDate,
      month: snapshot.month,
      year: snapshot.year,
      employeeId: snapshot.employeeId,
      employeeCode: snapshot.employeeCode,
      employeeName: snapshot.employeeName,
      employmentStatus: snapshot.employmentStatus,
      salaryAssignmentId: snapshot.salaryAssignmentId,
      salaryAssignmentVersion: snapshot.salaryAssignmentVersion,
      salaryAssignmentEffectiveFrom: snapshot.salaryAssignmentEffectiveFrom,
      salaryAssignmentEffectiveTo: snapshot.salaryAssignmentEffectiveTo,
      salaryStructureId: snapshot.salaryStructureId,
      salaryStructureCode: snapshot.salaryStructureCode,
      salaryStructureName: snapshot.salaryStructureName,
      salaryStructureVersion: snapshot.salaryStructureVersion,
      salaryBasis: snapshot.salaryBasis,
      salaryFrequency: snapshot.salaryFrequency,
      payrollSettingsId: snapshot.payrollSettingsId,
      payrollSettingsVersion: snapshot.payrollSettingsVersion,
      payrollCalculationRuleId: snapshot.payrollCalculationRuleId,
      payrollCalculationRuleVersion: snapshot.payrollCalculationRuleVersion,
      currency: snapshot.currency,
      roundingMode: snapshot.roundingMode,
      roundingPrecision: snapshot.roundingPrecision,
      prorationPolicy: snapshot.prorationPolicy,
      prorateFixedComponents: snapshot.prorateFixedComponents,
      prorateDeductions: snapshot.prorateDeductions,
      prorateEmployerContributions:
        snapshot.prorateEmployerContributions ??
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_EMPLOYER_CONTRIBUTIONS,
      negativeNetPayPolicy: snapshot.negativeNetPayPolicy,
      calendarDays: snapshot.calendarDays,
      tenureCalendarDays: snapshot.tenureCalendarDays ?? snapshot.calendarDays,
      eligibleWorkingDays: snapshot.eligibleWorkingDays ?? 0,
      weeklyOffDays: snapshot.weeklyOffDays ?? 0,
      holidayDays: snapshot.holidayDays ?? 0,
      presentDays: snapshot.presentDays ?? 0,
      halfDays: snapshot.halfDays ?? 0,
      paidLeaveDays: snapshot.paidLeaveDays ?? 0,
      unpaidLeaveDays: snapshot.unpaidLeaveDays ?? 0,
      unpaidLeaveLopDays: snapshot.unpaidLeaveLopDays ?? 0,
      attendanceAbsenceDays: snapshot.attendanceAbsenceDays ?? 0,
      attendanceAbsenceLopDays: snapshot.attendanceAbsenceLopDays ?? 0,
      halfDayDeductions: snapshot.halfDayDeductions ?? 0,
      totalLopDays: snapshot.totalLopDays ?? 0,
      pendingCancellationLeaveDays: snapshot.pendingCancellationLeaveDays ?? 0,
      attendanceLeaveWarnings: snapshot.attendanceLeaveWarnings ?? [],
      leaveAttendanceMismatchDates: snapshot.leaveAttendanceMismatchDates ?? [],
      prorationDenominatorDays: snapshot.prorationDenominatorDays,
      payableDays: snapshot.payableDays,
      prorationApplied: snapshot.prorationApplied,
      prorationFactor: snapshot.prorationFactor,
      executionOrder: snapshot.executionOrder,
      earnings: snapshot.earnings.map((item) => this.mapComponentItem(item)),
      deductions: snapshot.deductions.map((item) =>
        this.mapComponentItem(item),
      ),
      employerContributions: snapshot.employerContributions.map((item) =>
        this.mapComponentItem(item),
      ),
      grossEarnings: decimal128ToString(snapshot.grossEarnings),
      totalDeductions: decimal128ToString(snapshot.totalDeductions),
      employerContributionsTotal: decimal128ToString(
        snapshot.employerContributionsTotal,
      ),
      netSalary: decimal128ToString(snapshot.netSalary),
      netPayClamped: snapshot.netPayClamped,
    };
  }

  static toPreviewResponse(
    snapshot: PayrollCalculationSnapshot,
  ): PayrollCalculationPreviewResponseDto {
    return {
      persisted: false,
      snapshot: this.mapSnapshot(snapshot),
    };
  }

  static toRecordResponse(doc: PayrollRecordLean): PayrollRecordResponseDto {
    return {
      id: doc._id.toString(),
      persisted: true,
      payrollPeriodId: doc.payrollPeriodId.toString(),
      employeeId: doc.employeeId.toString(),
      salaryAssignmentId: doc.salaryAssignmentId.toString(),
      salaryStructureId: doc.salaryStructureId.toString(),
      grossEarnings: decimal128ToString(doc.grossEarnings),
      totalDeductions: decimal128ToString(doc.totalDeductions),
      employerContributions: decimal128ToString(doc.employerContributions),
      netSalary: decimal128ToString(doc.netSalary),
      status: doc.status,
      calculatedAt:
        doc.calculatedAt instanceof Date
          ? doc.calculatedAt.toISOString()
          : String(doc.calculatedAt),
      calculationVersion: doc.calculationVersion,
      version: doc.__v ?? 0,
      calculationSnapshot: this.mapSnapshot(doc.calculationSnapshot),
      createdBy: doc.createdBy.toString(),
      updatedBy: doc.updatedBy.toString(),
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : String(doc.createdAt),
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : String(doc.updatedAt),
    };
  }
}

import { Types } from 'mongoose';
import { Decimal, toDecimal } from '../../../common/utils/financial-math.util';
import { decimal128ToString } from '../../payroll-calculations/constants/payroll-calculation.constant';
import { PayrollCalculationMapper } from '../../payroll-calculations/mappers/payroll-calculation.mapper';
import { PayrollRecordLean } from '../../payroll-calculations/schemas/payroll-record.schema';
import { PayrollPeriodLean } from '../../payroll-periods/schemas/payroll-period.schema';
import {
  EmployeePayrollHistoryDetailsDto,
  EmployeePayrollHistoryItemDto,
  PayrollHistoryCurrencyTotalsDto,
  PayrollHistoryDetailsDto,
  PayrollHistoryListItemDto,
} from '../dto/payroll-history.dto';
import {
  BranchWiseReportRowDto,
  DepartmentWiseReportRowDto,
  EmployeeWiseReportRowDto,
  MonthlySummaryCurrencyRowDto,
  PayrollComponentReportRowDto,
  ReportPayrollPeriodMetaDto,
} from '../dto/payroll-reports.dto';
import {
  BranchWiseAggregateRow,
  ComponentAggregateRow,
  DepartmentWiseAggregateRow,
  EmployeeHistoryAggregateRow,
  EmployeeWiseAggregateRow,
  MonthlySummaryAggregateRow,
  PeriodCurrencyAggregateRow,
} from '../repositories/payroll-reporting.repository';

function formatIsoDateOnly(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

function formatIsoTimestamp(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : String(value);
}

export function formatMoneyDecimal(
  value: Types.Decimal128 | string | number | null | undefined,
  precision = 2,
): string {
  const safePrecision = Number.isInteger(precision) ? precision : 2;
  const raw =
    value === null || value === undefined ? '0' : decimal128ToString(value);
  return toDecimal(raw)
    .toDecimalPlaces(safePrecision, Decimal.ROUND_HALF_EVEN)
    .toFixed(safePrecision);
}

export function computeEmployerCost(
  gross: Types.Decimal128 | string | number,
  employerContributions: Types.Decimal128 | string | number,
  precision = 2,
): string {
  const safePrecision = Number.isInteger(precision) ? precision : 2;
  const total = toDecimal(decimal128ToString(gross)).plus(
    toDecimal(decimal128ToString(employerContributions)),
  );
  return total
    .toDecimalPlaces(safePrecision, Decimal.ROUND_HALF_EVEN)
    .toFixed(safePrecision);
}

export class PayrollReportingMapper {
  static toHistoryListItem(
    period: PayrollPeriodLean,
    currencyRows: PeriodCurrencyAggregateRow[],
  ): PayrollHistoryListItemDto {
    const single = currencyRows.length === 1 ? currencyRows[0] : null;
    const totalEmployees = currencyRows.reduce(
      (sum, row) => sum + row.employeeCount,
      0,
    );

    if (single) {
      const p = single.precision;
      return {
        periodId: period._id.toHexString(),
        periodCode: period.periodCode,
        periodName: period.periodName,
        startDate: formatIsoDateOnly(period.startDate),
        endDate: formatIsoDateOnly(period.endDate),
        paymentDate: formatIsoDateOnly(period.paymentDate),
        month: period.month,
        year: period.year,
        status: period.status,
        currency: single.currency,
        totalEmployees,
        totalGrossEarnings: formatMoneyDecimal(single.totalGrossEarnings, p),
        totalDeductions: formatMoneyDecimal(single.totalDeductions, p),
        totalNetSalary: formatMoneyDecimal(single.totalNetSalary, p),
        totalEmployerContributions: formatMoneyDecimal(
          single.totalEmployerContributions,
          p,
        ),
        totalEmployerCost: computeEmployerCost(
          single.totalGrossEarnings,
          single.totalEmployerContributions,
          p,
        ),
        finalizedAt: formatIsoTimestamp(period.updatedAt),
      };
    }

    const approval = period.approval;
    const fallbackGross = approval?.totalGrossEarnings ?? '0.00';
    const fallbackDed = approval?.totalDeductions ?? '0.00';
    const fallbackEr = approval?.totalEmployerContributions ?? '0.00';
    const fallbackNet = approval?.totalNetSalary ?? '0.00';
    const fallbackCost =
      approval?.totalEmployerCost ??
      computeEmployerCost(fallbackGross, fallbackEr, 2);

    return {
      periodId: period._id.toHexString(),
      periodCode: period.periodCode,
      periodName: period.periodName,
      startDate: formatIsoDateOnly(period.startDate),
      endDate: formatIsoDateOnly(period.endDate),
      paymentDate: formatIsoDateOnly(period.paymentDate),
      month: period.month,
      year: period.year,
      status: period.status,
      currency: currencyRows.length > 1 ? 'MIXED' : null,
      totalEmployees:
        totalEmployees > 0
          ? totalEmployees
          : (approval?.approvedRecordsCount ?? 0) +
            (approval?.alreadyApprovedRecordsCount ?? 0),
      totalGrossEarnings: fallbackGross,
      totalDeductions: fallbackDed,
      totalNetSalary: fallbackNet,
      totalEmployerContributions: fallbackEr,
      totalEmployerCost: fallbackCost,
      finalizedAt: formatIsoTimestamp(period.updatedAt),
    };
  }

  static toCurrencyTotalsDto(
    row: PeriodCurrencyAggregateRow,
  ): PayrollHistoryCurrencyTotalsDto {
    const p = row.precision;
    return {
      currency: row.currency,
      approvedEmployees: row.employeeCount,
      totalGrossEarnings: formatMoneyDecimal(row.totalGrossEarnings, p),
      totalDeductions: formatMoneyDecimal(row.totalDeductions, p),
      totalNetSalary: formatMoneyDecimal(row.totalNetSalary, p),
      totalEmployerContributions: formatMoneyDecimal(
        row.totalEmployerContributions,
        p,
      ),
      totalEmployerCost: computeEmployerCost(
        row.totalGrossEarnings,
        row.totalEmployerContributions,
        p,
      ),
    };
  }

  static toPeriodHistoryDetails(
    period: PayrollPeriodLean,
    stats: {
      currencyRows: PeriodCurrencyAggregateRow[];
      invalidatedCount: number;
      payslipCount: number;
    },
  ): PayrollHistoryDetailsDto {
    const totalsByCurrency = stats.currencyRows.map((row) =>
      this.toCurrencyTotalsDto(row),
    );
    const single = totalsByCurrency.length === 1 ? totalsByCurrency[0] : null;
    const totalApproved = totalsByCurrency.reduce(
      (sum, row) => sum + row.approvedEmployees,
      0,
    );
    const approval = period.approval;

    return {
      periodId: period._id.toHexString(),
      periodCode: period.periodCode,
      periodName: period.periodName,
      payrollFrequency: period.payrollFrequency,
      startDate: formatIsoDateOnly(period.startDate),
      endDate: formatIsoDateOnly(period.endDate),
      paymentDate: formatIsoDateOnly(period.paymentDate),
      month: period.month,
      year: period.year,
      status: period.status,
      finalizedAt: formatIsoTimestamp(period.updatedAt),
      finalizedBy: period.updatedBy ? period.updatedBy.toHexString() : null,
      approvedEmployeeCount: totalApproved,
      excludedInvalidatedCount: stats.invalidatedCount,
      generatedPayslipsCount: stats.payslipCount,
      currency: single
        ? single.currency
        : totalsByCurrency.length > 1
          ? 'MIXED'
          : null,
      totalGrossEarnings:
        single?.totalGrossEarnings ?? approval?.totalGrossEarnings ?? '0.00',
      totalDeductions:
        single?.totalDeductions ?? approval?.totalDeductions ?? '0.00',
      totalNetSalary:
        single?.totalNetSalary ?? approval?.totalNetSalary ?? '0.00',
      totalEmployerContributions:
        single?.totalEmployerContributions ??
        approval?.totalEmployerContributions ??
        '0.00',
      totalEmployerCost:
        single?.totalEmployerCost ?? approval?.totalEmployerCost ?? '0.00',
      totalsByCurrency,
      approval: approval
        ? {
            approvedBy: approval.approvedBy
              ? approval.approvedBy.toHexString()
              : null,
            approvedAt: approval.approvedAt
              ? formatIsoTimestamp(approval.approvedAt)
              : null,
            reason: approval.reason ?? null,
            acknowledgeAnomalies: Boolean(approval.acknowledgeAnomalies),
            acknowledgedAnomalyEmployees:
              approval.acknowledgedAnomalyEmployees ?? 0,
            acknowledgedWarningCodes: approval.acknowledgedWarningCodes ?? [],
          }
        : null,
    };
  }

  static toEmployeeHistoryItem(
    row: EmployeeHistoryAggregateRow,
  ): EmployeePayrollHistoryItemDto {
    const p = row.roundingPrecision;
    return {
      periodId: row.periodId.toHexString(),
      periodCode: row.periodCode,
      periodName: row.periodName,
      startDate: formatIsoDateOnly(row.startDate),
      endDate: formatIsoDateOnly(row.endDate),
      paymentDate: formatIsoDateOnly(row.paymentDate),
      month: row.month,
      year: row.year,
      grossEarnings: formatMoneyDecimal(row.grossEarnings, p),
      totalDeductions: formatMoneyDecimal(row.totalDeductions, p),
      employerContributions: formatMoneyDecimal(row.employerContributions, p),
      employerCost: computeEmployerCost(
        row.grossEarnings,
        row.employerContributions,
        p,
      ),
      netSalary: formatMoneyDecimal(row.netSalary, p),
      currency: row.currency,
      payrollRecordId: row.payrollRecordId.toHexString(),
      payrollCalculationVersion: row.payrollCalculationVersion,
      payslipAvailable: row.payslipAvailable,
    };
  }

  static toEmployeeHistoryDetails(params: {
    period: PayrollPeriodLean;
    record: PayrollRecordLean;
    payslipAvailable: boolean;
  }): EmployeePayrollHistoryDetailsDto {
    const { period, record, payslipAvailable } = params;
    const snap = record.calculationSnapshot;
    const p = snap.roundingPrecision ?? 2;

    return {
      periodId: period._id.toHexString(),
      periodCode: period.periodCode,
      periodName: period.periodName,
      startDate: formatIsoDateOnly(period.startDate),
      endDate: formatIsoDateOnly(period.endDate),
      paymentDate: formatIsoDateOnly(period.paymentDate),
      month: period.month,
      year: period.year,
      finalizedAt: formatIsoTimestamp(period.updatedAt),
      payrollRecordId: record._id.toHexString(),
      employeeId: record.employeeId.toHexString(),
      payrollCalculationVersion: record.calculationVersion,
      payslipAvailable,
      grossEarnings: formatMoneyDecimal(record.grossEarnings, p),
      totalDeductions: formatMoneyDecimal(record.totalDeductions, p),
      employerContributions: formatMoneyDecimal(
        record.employerContributions,
        p,
      ),
      employerCost: computeEmployerCost(
        record.grossEarnings,
        record.employerContributions,
        p,
      ),
      netSalary: formatMoneyDecimal(record.netSalary, p),
      currency: snap.currency,
      lopSummary: {
        calendarDays: snap.calendarDays,
        payableDays: snap.payableDays,
        presentDays: snap.presentDays ?? 0,
        halfDays: snap.halfDays ?? 0,
        paidLeaveDays: snap.paidLeaveDays ?? 0,
        unpaidLeaveDays: snap.unpaidLeaveDays ?? 0,
        unpaidLeaveLopDays: snap.unpaidLeaveLopDays ?? 0,
        attendanceAbsenceDays: snap.attendanceAbsenceDays ?? 0,
        attendanceAbsenceLopDays: snap.attendanceAbsenceLopDays ?? 0,
        halfDayDeductions: snap.halfDayDeductions ?? 0,
        totalLopDays: snap.totalLopDays ?? 0,
      },
      calculationSnapshot: PayrollCalculationMapper.mapSnapshot(snap),
    };
  }

  static toReportPeriodMeta(
    period: PayrollPeriodLean,
  ): ReportPayrollPeriodMetaDto {
    return {
      periodId: period._id.toHexString(),
      periodCode: period.periodCode,
      periodName: period.periodName,
      startDate: formatIsoDateOnly(period.startDate),
      endDate: formatIsoDateOnly(period.endDate),
      paymentDate: formatIsoDateOnly(period.paymentDate),
      month: period.month,
      year: period.year,
      finalizedAt: formatIsoTimestamp(period.updatedAt),
    };
  }

  static toMonthlySummaryRow(
    row: MonthlySummaryAggregateRow,
  ): MonthlySummaryCurrencyRowDto {
    const p = row.precision;
    return {
      currency: row.currency,
      totalEmployees: row.totalEmployees,
      totalRecords: row.totalRecords,
      totalGrossEarnings: formatMoneyDecimal(row.totalGrossEarnings, p),
      totalEmployeeDeductions: formatMoneyDecimal(
        row.totalEmployeeDeductions,
        p,
      ),
      totalNetSalary: formatMoneyDecimal(row.totalNetSalary, p),
      totalEmployerContributions: formatMoneyDecimal(
        row.totalEmployerContributions,
        p,
      ),
      totalEmployerCost: computeEmployerCost(
        row.totalGrossEarnings,
        row.totalEmployerContributions,
        p,
      ),
      totalLOPDays: row.totalLOPDays,
    };
  }

  static toDepartmentWiseRow(
    row: DepartmentWiseAggregateRow,
  ): DepartmentWiseReportRowDto {
    const p = row.precision;
    return {
      departmentId: row.departmentId ? row.departmentId.toHexString() : null,
      departmentName: row.departmentName,
      currency: row.currency,
      employeeCount: row.employeeCount,
      recordCount: row.recordCount,
      grossEarnings: formatMoneyDecimal(row.grossEarnings, p),
      employeeDeductions: formatMoneyDecimal(row.employeeDeductions, p),
      netSalary: formatMoneyDecimal(row.netSalary, p),
      employerContributions: formatMoneyDecimal(row.employerContributions, p),
      employerCost: computeEmployerCost(
        row.grossEarnings,
        row.employerContributions,
        p,
      ),
    };
  }

  static toBranchWiseRow(row: BranchWiseAggregateRow): BranchWiseReportRowDto {
    const p = row.precision;
    return {
      branchId: row.branchId ? row.branchId.toHexString() : null,
      branchName: row.branchName,
      currency: row.currency,
      employeeCount: row.employeeCount,
      recordCount: row.recordCount,
      grossEarnings: formatMoneyDecimal(row.grossEarnings, p),
      deductions: formatMoneyDecimal(row.deductions, p),
      netSalary: formatMoneyDecimal(row.netSalary, p),
      employerContributions: formatMoneyDecimal(row.employerContributions, p),
      employerCost: computeEmployerCost(
        row.grossEarnings,
        row.employerContributions,
        p,
      ),
    };
  }

  static toEmployeeWiseRow(
    row: EmployeeWiseAggregateRow,
  ): EmployeeWiseReportRowDto {
    const p = row.precision;
    return {
      employeeId: row.employeeId.toHexString(),
      employeeCode: row.employeeCode,
      employeeName: row.employeeName,
      department: {
        id: row.departmentId ? row.departmentId.toHexString() : null,
        name: row.departmentName,
      },
      branch: {
        id: row.branchId ? row.branchId.toHexString() : null,
        name: row.branchName,
      },
      currency: row.currency,
      periodCount: row.periodCount,
      grossEarnings: formatMoneyDecimal(row.grossEarnings, p),
      deductions: formatMoneyDecimal(row.deductions, p),
      netSalary: formatMoneyDecimal(row.netSalary, p),
      employerContributions: formatMoneyDecimal(row.employerContributions, p),
      employerCost: computeEmployerCost(
        row.grossEarnings,
        row.employerContributions,
        p,
      ),
      totalLOPDays: row.totalLOPDays,
    };
  }

  static toComponentReportRow(
    row: ComponentAggregateRow,
  ): PayrollComponentReportRowDto {
    const p = row.precision;
    return {
      componentId: row.componentId,
      componentName: row.componentName,
      componentCode: row.componentCode,
      componentType: row.componentType,
      currency: row.currency,
      totalAmount: formatMoneyDecimal(row.totalAmount, p),
      employeeCount: row.employeeCount,
      recordCount: row.recordCount,
    };
  }
}

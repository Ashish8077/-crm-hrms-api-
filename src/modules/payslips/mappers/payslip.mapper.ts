import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { Decimal, toDecimal } from '../../../common/utils/financial-math.util';
import { PayrollPeriodLean } from '../../payroll-periods/schemas/payroll-period.schema';
import { decimal128ToString } from '../../payroll-calculations/constants/payroll-calculation.constant';
import {
  PayrollRecordLean,
  PayrollSnapshotComponentItem,
} from '../../payroll-calculations/schemas/payroll-record.schema';
import {
  buildSafePayslipFilename,
  formatMoneyAmountInWords,
} from '../constants/payslip.constant';
import { PayslipListItemDto, PayslipResponseDto } from '../dto/payslip.dto';
import { PayslipLean } from '../schemas/payslip.schema';

export interface PayslipRenderComponentLine {
  componentName: string;
  amount: string;
  prorationApplied: boolean;
}

export interface PayslipOrganizationInfo {
  companyName?: string | null;
  companyAddress?: string | null;
  departmentName?: string | null;
  designationName?: string | null;
  branchName?: string | null;
  branchAddress?: string | null;
}

export interface PayslipRenderData {
  companyName: string | null;
  companyAddress: string | null;
  periodCode: string;
  periodName: string;
  startDate: string;
  endDate: string;
  paymentDate: string | null;
  payrollFrequency: string;
  currency: string;
  roundingPrecision: number;
  employeeName: string;
  employeeCode: string;
  employmentStatus: string;
  departmentName: string | null;
  designationName: string | null;
  branchName: string | null;
  calendarDays: number;
  payableDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  totalLopDays: number;
  earnings: PayslipRenderComponentLine[];
  deductions: PayslipRenderComponentLine[];
  employerContributions: PayslipRenderComponentLine[];
  grossEarnings: string;
  totalDeductions: string;
  totalEmployerContributions: string;
  totalEmployerCost: string;
  netSalary: string;
  netPayClamped: boolean;
  netSalaryInWords: string;
  fileName: string;
  deterministicDate: Date;
}

const EPSILON = new Decimal('0.01');

function formatIsoDateOnly(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function sumComponentDecimals(items: PayrollSnapshotComponentItem[]): Decimal {
  return items.reduce(
    (sum, item) => sum.plus(toDecimal(decimal128ToString(item.finalAmount))),
    new Decimal(0),
  );
}

export class PayslipMapper {
  /**
   * Maps an immutable FINALIZED PayrollPeriod and APPROVED PayrollRecord calculation snapshot
   * into verified payslip rendering data. Never recalculates payroll or mutates snapshot values.
   */
  static buildRenderData(
    period: PayrollPeriodLean,
    record: PayrollRecordLean,
    orgInfo?: PayslipOrganizationInfo,
  ): PayslipRenderData {
    const snap = record.calculationSnapshot;
    if (!snap) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Payroll calculation snapshot is missing and cannot be rendered into a payslip.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const requiredStrings: Array<[string, string | undefined | null]> = [
      ['periodCode', snap.periodCode],
      ['periodName', snap.periodName],
      ['startDate', snap.startDate],
      ['endDate', snap.endDate],
      ['employeeCode', snap.employeeCode],
      ['employeeName', snap.employeeName],
      ['currency', snap.currency],
    ];
    for (const [field, val] of requiredStrings) {
      if (!val || String(val).trim().length === 0) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Required payroll snapshot field '${field}' is missing for payslip generation.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    if (
      !Array.isArray(snap.earnings) ||
      !Array.isArray(snap.deductions) ||
      !Array.isArray(snap.employerContributions)
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Payroll snapshot component breakdowns are missing for payslip generation.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const precision = Number.isInteger(snap.roundingPrecision)
      ? snap.roundingPrecision
      : 2;

    const recordGrossDec = toDecimal(decimal128ToString(record.grossEarnings));
    const recordDedDec = toDecimal(decimal128ToString(record.totalDeductions));
    const recordErDec = toDecimal(
      decimal128ToString(record.employerContributions),
    );
    const recordNetDec = toDecimal(decimal128ToString(record.netSalary));

    const snapGrossDec = toDecimal(decimal128ToString(snap.grossEarnings));
    const snapDedDec = toDecimal(decimal128ToString(snap.totalDeductions));
    const snapErDec = toDecimal(
      decimal128ToString(snap.employerContributionsTotal),
    );
    const snapNetDec = toDecimal(decimal128ToString(snap.netSalary));

    // Reconcile persisted record totals with snapshot totals and component line sums
    if (
      recordGrossDec.minus(snapGrossDec).abs().greaterThan(EPSILON) ||
      recordDedDec.minus(snapDedDec).abs().greaterThan(EPSILON) ||
      recordErDec.minus(snapErDec).abs().greaterThan(EPSILON) ||
      recordNetDec.minus(snapNetDec).abs().greaterThan(EPSILON)
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Persisted payroll totals do not reconcile with calculation snapshot totals.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const earningsSum = sumComponentDecimals(snap.earnings);
    const deductionsSum = sumComponentDecimals(snap.deductions);
    const employerSum = sumComponentDecimals(snap.employerContributions);

    if (
      earningsSum.minus(recordGrossDec).abs().greaterThan(EPSILON) ||
      deductionsSum.minus(recordDedDec).abs().greaterThan(EPSILON) ||
      employerSum.minus(recordErDec).abs().greaterThan(EPSILON)
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Component breakdown sums in payroll snapshot do not reconcile with persisted totals.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const expectedNet = recordGrossDec.minus(recordDedDec);
    const netReconciles = snap.netPayClamped
      ? recordNetDec.equals(0) && expectedNet.lessThanOrEqualTo(0)
      : expectedNet.minus(recordNetDec).abs().lessThanOrEqualTo(EPSILON);

    if (!netReconciles) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Persisted net salary does not reconcile with gross earnings minus employee deductions.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const mapLines = (
      items: PayrollSnapshotComponentItem[],
    ): PayslipRenderComponentLine[] =>
      items.map((item) => ({
        componentName: item.componentName,
        amount: toDecimal(decimal128ToString(item.finalAmount)).toFixed(
          precision,
        ),
        prorationApplied: Boolean(item.prorationApplied),
      }));

    const grossStr = recordGrossDec.toFixed(precision);
    const dedStr = recordDedDec.toFixed(precision);
    const erStr = recordErDec.toFixed(precision);
    const erCostStr = recordGrossDec.plus(recordErDec).toFixed(precision);
    const netStr = recordNetDec.toFixed(precision);

    const companyName =
      orgInfo?.companyName?.trim() || orgInfo?.branchName?.trim() || null;
    const companyAddress =
      orgInfo?.companyAddress?.trim() || orgInfo?.branchAddress?.trim() || null;

    return {
      companyName,
      companyAddress,
      periodCode: snap.periodCode,
      periodName: snap.periodName,
      startDate: snap.startDate,
      endDate: snap.endDate,
      paymentDate: formatIsoDateOnly(period.paymentDate),
      payrollFrequency: String(snap.payrollFrequency),
      currency: snap.currency,
      roundingPrecision: precision,
      employeeName: snap.employeeName,
      employeeCode: snap.employeeCode,
      employmentStatus: String(snap.employmentStatus),
      departmentName: orgInfo?.departmentName?.trim() || null,
      designationName: orgInfo?.designationName?.trim() || null,
      branchName: orgInfo?.branchName?.trim() || null,
      calendarDays: snap.calendarDays,
      payableDays: snap.payableDays,
      presentDays: snap.presentDays ?? 0,
      paidLeaveDays: snap.paidLeaveDays ?? 0,
      unpaidLeaveDays: snap.unpaidLeaveDays ?? 0,
      totalLopDays: snap.totalLopDays ?? 0,
      earnings: mapLines(snap.earnings),
      deductions: mapLines(snap.deductions),
      employerContributions: mapLines(snap.employerContributions),
      grossEarnings: grossStr,
      totalDeductions: dedStr,
      totalEmployerContributions: erStr,
      totalEmployerCost: erCostStr,
      netSalary: netStr,
      netPayClamped: Boolean(snap.netPayClamped),
      netSalaryInWords: formatMoneyAmountInWords(
        netStr,
        snap.currency,
        precision,
      ),
      fileName: buildSafePayslipFilename(snap.periodCode, snap.employeeCode),
      deterministicDate:
        record.approvedAt ??
        record.calculatedAt ??
        snap.calculatedAt ??
        new Date('2026-01-01T00:00:00.000Z'),
    };
  }

  static toResponseDto(
    payslip: PayslipLean,
    record: PayrollRecordLean,
  ): PayslipResponseDto {
    const snap = record.calculationSnapshot;
    const precision = Number.isInteger(snap?.roundingPrecision)
      ? snap.roundingPrecision
      : 2;

    return {
      id: payslip._id.toHexString(),
      payrollPeriodId: payslip.payrollPeriodId.toHexString(),
      payrollRecordId: payslip.payrollRecordId.toHexString(),
      employeeId: payslip.employeeId.toHexString(),
      periodCode: snap.periodCode,
      periodName: snap.periodName,
      employeeCode: snap.employeeCode,
      employeeName: snap.employeeName,
      currency: snap.currency,
      grossEarnings: toDecimal(
        decimal128ToString(record.grossEarnings),
      ).toFixed(precision),
      totalDeductions: toDecimal(
        decimal128ToString(record.totalDeductions),
      ).toFixed(precision),
      netSalary: toDecimal(decimal128ToString(record.netSalary)).toFixed(
        precision,
      ),
      payrollCalculationVersion: payslip.payrollCalculationVersion,
      templateVersion: payslip.templateVersion,
      fileName: payslip.fileName,
      mimeType: payslip.mimeType,
      fileSize: payslip.fileSize,
      generatedAt: payslip.generatedAt.toISOString(),
      generatedBy: payslip.generatedBy.toHexString(),
      createdAt: payslip.createdAt.toISOString(),
      updatedAt: payslip.updatedAt.toISOString(),
      version: payslip.__v ?? 0,
    };
  }

  static toListItemDto(row: {
    id: Types.ObjectId;
    payrollPeriodId: Types.ObjectId;
    payrollRecordId: Types.ObjectId;
    employeeId: Types.ObjectId;
    employeeCode: string;
    employeeName: string;
    currency: string;
    grossEarnings: Types.Decimal128 | number | string;
    totalDeductions: Types.Decimal128 | number | string;
    netSalary: Types.Decimal128 | number | string;
    payrollCalculationVersion: number;
    templateVersion: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    generatedAt: Date;
    generatedBy: Types.ObjectId;
  }): PayslipListItemDto {
    return {
      id: row.id.toHexString(),
      payrollPeriodId: row.payrollPeriodId.toHexString(),
      payrollRecordId: row.payrollRecordId.toHexString(),
      employeeId: row.employeeId.toHexString(),
      employeeCode: row.employeeCode,
      employeeName: row.employeeName,
      currency: row.currency,
      grossEarnings: toDecimal(decimal128ToString(row.grossEarnings)).toFixed(
        2,
      ),
      totalDeductions: toDecimal(
        decimal128ToString(row.totalDeductions),
      ).toFixed(2),
      netSalary: toDecimal(decimal128ToString(row.netSalary)).toFixed(2),
      payrollCalculationVersion: row.payrollCalculationVersion,
      templateVersion: row.templateVersion,
      fileName: row.fileName,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      generatedAt:
        row.generatedAt instanceof Date
          ? row.generatedAt.toISOString()
          : String(row.generatedAt),
      generatedBy: row.generatedBy.toHexString(),
    };
  }
}

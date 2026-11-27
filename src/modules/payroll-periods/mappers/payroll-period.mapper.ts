import { PayrollFrequency } from '../../payroll-configuration/constants/payroll-configuration.constant';
import {
  PayrollPeriodStatus,
  PayrollProcessingStatus,
} from '../constants/payroll-period.constant';
import { PayrollPeriodLean } from '../schemas/payroll-period.schema';

export interface PayrollPeriodProcessingSummaryResponse {
  processingStatus: PayrollProcessingStatus;
  totalEligibleEmployees: number;
  processedEmployees: number;
  successfulEmployees: number;
  failedEmployees: number;
  skippedUpToDateEmployees: number;
  recalculatedEmployees: number;
  processingAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
  lastAttemptAt: string | null;
  lastErrorSummary: string | null;
}

export interface PayrollPeriodResponse {
  id: string;
  periodName: string;
  periodCode: string;
  payrollFrequency: PayrollFrequency;
  startDate: string;
  endDate: string;
  paymentDate: string;
  month: number;
  year: number;
  status: PayrollPeriodStatus;
  processing: PayrollPeriodProcessingSummaryResponse;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export class PayrollPeriodMapper {
  static toResponse(doc: PayrollPeriodLean): PayrollPeriodResponse {
    const proc = doc.processing;
    return {
      id: doc._id.toString(),
      periodName: doc.periodName,
      periodCode: doc.periodCode,
      payrollFrequency: doc.payrollFrequency,
      startDate:
        doc.startDate instanceof Date
          ? doc.startDate.toISOString().split('T')[0]
          : String(doc.startDate),
      endDate:
        doc.endDate instanceof Date
          ? doc.endDate.toISOString().split('T')[0]
          : String(doc.endDate),
      paymentDate:
        doc.paymentDate instanceof Date
          ? doc.paymentDate.toISOString().split('T')[0]
          : String(doc.paymentDate),
      month: doc.month,
      year: doc.year,
      status: doc.status,
      processing: {
        processingStatus:
          proc?.processingStatus ?? PayrollProcessingStatus.NOT_STARTED,
        totalEligibleEmployees: proc?.totalEligibleEmployees ?? 0,
        processedEmployees: proc?.processedEmployees ?? 0,
        successfulEmployees: proc?.successfulEmployees ?? 0,
        failedEmployees: proc?.failedEmployees ?? 0,
        skippedUpToDateEmployees: proc?.skippedUpToDateEmployees ?? 0,
        recalculatedEmployees: proc?.recalculatedEmployees ?? 0,
        processingAttempts: proc?.processingAttempts ?? 0,
        startedAt:
          proc?.startedAt instanceof Date
            ? proc.startedAt.toISOString()
            : proc?.startedAt
              ? String(proc.startedAt)
              : null,
        completedAt:
          proc?.completedAt instanceof Date
            ? proc.completedAt.toISOString()
            : proc?.completedAt
              ? String(proc.completedAt)
              : null,
        lastAttemptAt:
          proc?.lastAttemptAt instanceof Date
            ? proc.lastAttemptAt.toISOString()
            : proc?.lastAttemptAt
              ? String(proc.lastAttemptAt)
              : null,
        lastErrorSummary: proc?.lastErrorSummary ?? null,
      },
      notes: doc.notes ?? null,
      createdBy: doc.createdBy ? doc.createdBy.toString() : null,
      updatedBy: doc.updatedBy ? doc.updatedBy.toString() : null,
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : String(doc.createdAt),
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : String(doc.updatedAt),
      version: doc.__v ?? 0,
    };
  }
}

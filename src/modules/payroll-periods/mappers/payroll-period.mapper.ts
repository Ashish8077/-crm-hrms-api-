import { PayrollFrequency } from '../../payroll-configuration/constants/payroll-configuration.constant';
import { PayrollPeriodStatus } from '../constants/payroll-period.constant';
import { PayrollPeriodLean } from '../schemas/payroll-period.schema';

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
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export class PayrollPeriodMapper {
  static toResponse(doc: PayrollPeriodLean): PayrollPeriodResponse {
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

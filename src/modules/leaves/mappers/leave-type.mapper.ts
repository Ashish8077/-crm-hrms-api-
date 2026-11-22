import { LeaveTypeLean } from '../repositories/leave-type.repository';

export interface LeaveTypeResponse {
  id: string;
  name: string;
  code: string;
  description?: string;
  isPaid: boolean;
  annualAllocation: number;
  allowHalfDay: boolean;
  allowNegativeBalance: boolean;
  allowDuringNoticePeriod: boolean;
  applicableEmploymentStatuses: string[];
  deductWeekends: boolean;
  deductHolidays: boolean;
  maxConsecutiveDays: number | null;
  requiresAttachment: boolean;
  isCarryForwardEnabled: boolean;
  maxCarryForwardDays: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export class LeaveTypeMapper {
  static toResponse(doc: LeaveTypeLean): LeaveTypeResponse {
    return {
      id: doc._id.toString(),
      name: doc.name,
      code: doc.code,
      description: doc.description,
      isPaid: doc.isPaid,
      annualAllocation: doc.annualAllocation,
      allowHalfDay: doc.allowHalfDay,
      allowNegativeBalance: doc.allowNegativeBalance,
      allowDuringNoticePeriod: doc.allowDuringNoticePeriod,
      applicableEmploymentStatuses: doc.applicableEmploymentStatuses || [],
      deductWeekends: doc.deductWeekends,
      deductHolidays: doc.deductHolidays,
      maxConsecutiveDays: doc.maxConsecutiveDays ?? null,
      requiresAttachment: doc.requiresAttachment,
      isCarryForwardEnabled: doc.isCarryForwardEnabled,
      maxCarryForwardDays: doc.maxCarryForwardDays,
      isActive: doc.isActive,
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }

  static toResponseList(docs: LeaveTypeLean[]): LeaveTypeResponse[] {
    return docs.map((d) => this.toResponse(d));
  }
}

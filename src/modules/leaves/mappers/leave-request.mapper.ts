import { LeaveRequestLean } from '../repositories/leave-request.repository';

export interface LeaveRequestResponse {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  leaveTypeSnapshot: {
    name: string;
    code: string;
    isPaid: boolean;
    allowHalfDay: boolean;
    deductWeekends: boolean;
    deductHolidays: boolean;
  };
  startDate: string;
  endDate: string;
  totalDays: number;
  isHalfDay: boolean;
  halfDaySession: string | null;
  yearBreakdown: Array<{ year: number; days: number }>;
  reason: string;
  attachmentUrl?: string;
  reportingManagerId: string | null;
  status: string;
  rejectionReason?: string;
  cancellationReason?: string;
  cancellationReviewedBy?: string | null;
  cancellationReviewedAt?: string | null;
  reconciliationNotes?: string;
  approvalTimeline: Array<{
    approverId: string;
    fromStatus: string;
    toStatus: string;
    remarks?: string;
    timestamp: string;
    isOverride: boolean;
  }>;
  appliedAt: string;
  createdAt?: string;
  updatedAt?: string;
}

export class LeaveRequestMapper {
  static toResponse(doc: LeaveRequestLean): LeaveRequestResponse {
    return {
      id: doc._id.toString(),
      employeeId: doc.employeeId.toString(),
      leaveTypeId: doc.leaveTypeId.toString(),
      leaveTypeSnapshot: {
        name: doc.leaveTypeSnapshot.name,
        code: doc.leaveTypeSnapshot.code,
        isPaid: doc.leaveTypeSnapshot.isPaid,
        allowHalfDay: doc.leaveTypeSnapshot.allowHalfDay,
        deductWeekends: doc.leaveTypeSnapshot.deductWeekends,
        deductHolidays: doc.leaveTypeSnapshot.deductHolidays,
      },
      startDate: doc.startDate,
      endDate: doc.endDate,
      totalDays: doc.totalDays,
      isHalfDay: doc.isHalfDay,
      halfDaySession: doc.halfDaySession,
      yearBreakdown: doc.yearBreakdown.map((y) => ({
        year: y.year,
        days: y.days,
      })),
      reason: doc.reason,
      attachmentUrl: doc.attachmentUrl,
      reportingManagerId: doc.reportingManagerId
        ? doc.reportingManagerId.toString()
        : null,
      status: doc.status,
      rejectionReason: doc.rejectionReason,
      cancellationReason: doc.cancellationReason,
      cancellationReviewedBy: doc.cancellationReviewedBy
        ? doc.cancellationReviewedBy.toString()
        : null,
      cancellationReviewedAt: doc.cancellationReviewedAt?.toISOString() || null,
      reconciliationNotes: doc.reconciliationNotes,
      approvalTimeline: (doc.approvalTimeline || []).map((t) => ({
        approverId: t.approverId.toString(),
        fromStatus: t.fromStatus,
        toStatus: t.toStatus,
        remarks: t.remarks,
        timestamp: t.timestamp.toISOString(),
        isOverride: t.isOverride,
      })),
      appliedAt:
        doc.appliedAt?.toISOString() || doc.createdAt?.toISOString() || '',
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }

  static toResponseList(docs: LeaveRequestLean[]): LeaveRequestResponse[] {
    return docs.map((d) => this.toResponse(d));
  }
}

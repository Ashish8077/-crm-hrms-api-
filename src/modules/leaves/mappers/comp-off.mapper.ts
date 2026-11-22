import { CompOffRecordLean } from '../repositories/comp-off-record.repository';

export interface CompOffResponse {
  id: string;
  employeeId: string;
  attendanceDate: string;
  overtimeMinutes: number;
  earnedDays: number;
  status: string;
  expiryDate: string;
  redeemedAt?: string | null;
  redeemedLeaveRequestId?: string | null;
  reason: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewRemarks?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class CompOffMapper {
  static toResponse(doc: CompOffRecordLean): CompOffResponse {
    return {
      id: doc._id.toString(),
      employeeId: doc.employeeId.toString(),
      attendanceDate: doc.attendanceDate,
      overtimeMinutes: doc.overtimeMinutes,
      earnedDays: doc.earnedDays,
      status: doc.status,
      expiryDate: doc.expiryDate,
      redeemedAt: doc.redeemedAt?.toISOString() || null,
      redeemedLeaveRequestId: doc.redeemedLeaveRequestId
        ? doc.redeemedLeaveRequestId.toString()
        : null,
      reason: doc.reason,
      reviewedBy: doc.reviewedBy ? doc.reviewedBy.toString() : null,
      reviewedAt: doc.reviewedAt?.toISOString() || null,
      reviewRemarks: doc.reviewRemarks,
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }

  static toResponseList(docs: CompOffRecordLean[]): CompOffResponse[] {
    return docs.map((d) => this.toResponse(d));
  }
}

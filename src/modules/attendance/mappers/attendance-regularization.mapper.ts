import { Types } from 'mongoose';
import { RegularizationStatus } from '../constants/attendance.constant';
import { AttendanceRegularizationLean } from '../repositories/attendance-regularization.repository';
import { AttendanceRegularization } from '../schemas/attendance-regularization.schema';
import { CreateRegularizationDto } from '../dto/create-regularization.dto';

export interface AttendanceRegularizationResponse {
  id: string;
  employeeId: string;
  attendanceId: string | null;
  attendanceDate: string;
  requestedCheckInTime: Date;
  requestedCheckOutTime: Date;
  reason: string;
  status: RegularizationStatus;
  appliedAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewRemarks?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class AttendanceRegularizationMapper {
  /**
   * Maps regularization creation DTO and resolved parameters to persistence input.
   */
  static toCreateData(
    dto: CreateRegularizationDto,
    employeeId: Types.ObjectId,
    attendanceId: Types.ObjectId | null,
  ): Partial<AttendanceRegularization> {
    return {
      employeeId,
      attendanceId,
      attendanceDate: dto.attendanceDate.trim(),
      requestedCheckInTime: new Date(dto.requestedCheckInTime),
      requestedCheckOutTime: new Date(dto.requestedCheckOutTime),
      reason: dto.reason.trim(),
      status: RegularizationStatus.PENDING,
      appliedAt: new Date(),
    };
  }

  /**
   * Maps review action (approval or rejection) to persistence update data.
   */
  static toReviewUpdateData(
    status: RegularizationStatus,
    reviewedBy: Types.ObjectId,
    reviewedAt: Date,
    reviewRemarks?: string,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {
      status,
      reviewedBy,
      reviewedAt,
    };
    if (reviewRemarks !== undefined) {
      data.reviewRemarks = reviewRemarks.trim();
    }
    return data;
  }

  /**
   * Maps an AttendanceRegularization entity/lean document to an API response DTO.
   */
  static toResponse(
    doc: AttendanceRegularizationLean,
  ): AttendanceRegularizationResponse {
    return {
      id: doc._id.toString(),
      employeeId: doc.employeeId.toString(),
      attendanceId: doc.attendanceId ? doc.attendanceId.toString() : null,
      attendanceDate: doc.attendanceDate,
      requestedCheckInTime: doc.requestedCheckInTime,
      requestedCheckOutTime: doc.requestedCheckOutTime,
      reason: doc.reason,
      status: doc.status,
      appliedAt: doc.appliedAt,
      reviewedBy: doc.reviewedBy ? doc.reviewedBy.toString() : null,
      reviewedAt: doc.reviewedAt,
      reviewRemarks: doc.reviewRemarks,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  static toResponseList(
    docs: AttendanceRegularizationLean[],
  ): AttendanceRegularizationResponse[] {
    return docs.map((d) => AttendanceRegularizationMapper.toResponse(d));
  }
}

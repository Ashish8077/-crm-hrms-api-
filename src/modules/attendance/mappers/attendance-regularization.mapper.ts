import { Types } from 'mongoose';
import {
  RegularizationStatus,
  RegularizationType,
} from '../constants/attendance.constant';
import { AttendanceRegularizationLean } from '../repositories/attendance-regularization.repository';
import { AttendanceRegularization } from '../schemas/attendance-regularization.schema';
import { CreateRegularizationDto } from '../dto/create-regularization.dto';
import { AttendanceCalculationUtil } from '../utils/attendance-calculation.util';

export interface AttendanceRegularizationResponse {
  id: string;
  employeeId: string;
  attendanceId: string | null;
  attendanceDate: string;
  type: RegularizationType;
  originalCheckInTime: string | Date | null;
  originalCheckOutTime: string | Date | null;
  requestedCheckInTime: string | Date | null;
  requestedCheckOutTime: string | Date | null;
  reason: string;
  status: RegularizationStatus;
  appliedAt: string | Date;
  reviewedBy: string | null;
  reviewedAt: string | Date | null;
  reviewRemarks?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export class AttendanceRegularizationMapper {
  /**
   * Maps regularization creation DTO and resolved parameters to persistence input.
   */
  static toCreateData(
    dto: CreateRegularizationDto,
    employeeId: Types.ObjectId,
    attendanceId: Types.ObjectId | null,
    originalCheckInTime: Date | null,
    originalCheckOutTime: Date | null,
    resolvedRequestedCheckInTime: Date | null,
    resolvedRequestedCheckOutTime: Date | null,
  ): Partial<AttendanceRegularization> {
    return {
      employeeId,
      attendanceId,
      attendanceDate: dto.attendanceDate.trim(),
      type: dto.type ?? RegularizationType.TIME_CORRECTION,
      originalCheckInTime,
      originalCheckOutTime,
      requestedCheckInTime: resolvedRequestedCheckInTime,
      requestedCheckOutTime: resolvedRequestedCheckOutTime,
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
      type: doc.type ?? RegularizationType.TIME_CORRECTION,
      originalCheckInTime: AttendanceCalculationUtil.formatZonedISO(
        doc.originalCheckInTime,
      ),
      originalCheckOutTime: AttendanceCalculationUtil.formatZonedISO(
        doc.originalCheckOutTime,
      ),
      requestedCheckInTime: AttendanceCalculationUtil.formatZonedISO(
        doc.requestedCheckInTime,
      ),
      requestedCheckOutTime: AttendanceCalculationUtil.formatZonedISO(
        doc.requestedCheckOutTime,
      ),
      reason: doc.reason,
      status: doc.status,
      appliedAt:
        AttendanceCalculationUtil.formatZonedISO(doc.appliedAt) ??
        doc.appliedAt,
      reviewedBy: doc.reviewedBy ? doc.reviewedBy.toString() : null,
      reviewedAt: AttendanceCalculationUtil.formatZonedISO(doc.reviewedAt),
      reviewRemarks: doc.reviewRemarks,
      createdAt:
        AttendanceCalculationUtil.formatZonedISO(doc.createdAt) ?? undefined,
      updatedAt:
        AttendanceCalculationUtil.formatZonedISO(doc.updatedAt) ?? undefined,
    };
  }

  static toResponseList(
    docs: AttendanceRegularizationLean[],
  ): AttendanceRegularizationResponse[] {
    return docs.map((d) => AttendanceRegularizationMapper.toResponse(d));
  }
}

import { Types } from 'mongoose';
import {
  AttendanceSource,
  AttendanceStatus,
  AttendanceType,
  BreakType,
} from '../constants/attendance.constant';
import { AttendanceLean } from '../repositories/attendance.repository';
import {
  Attendance,
  BreakSession,
  GeoLocation,
  ShiftSnapshot,
} from '../schemas/attendance.schema';

export interface CreateAttendanceInput {
  employeeId: Types.ObjectId | string;
  attendanceDate: string;
  date: Date;
  shiftId: Types.ObjectId | string;
  shiftSnapshot: ShiftSnapshot;
  checkInTime: Date;
  status?: AttendanceStatus;
  attendanceType?: AttendanceType;
  breaks?: BreakSession[];
  isLate?: boolean;
  lateMinutes?: number;
  checkInSource?: AttendanceSource;
  checkInIp?: string;
  checkInLocation?: GeoLocation;
  checkInNotes?: string;
  regularizationId?: Types.ObjectId | string | null;
}

export interface CheckOutUpdateInput {
  checkOutTime: Date;
  status: AttendanceStatus;
  breaks: BreakSession[];
  totalBreakMinutes: number;
  totalWorkMinutes: number;
  overtimeMinutes: number;
  isEarlyDeparture: boolean;
  earlyDepartureMinutes: number;
  checkOutSource?: AttendanceSource;
  checkOutIp?: string;
  checkOutLocation?: GeoLocation;
  checkOutNotes?: string;
}

export interface RegularizedAttendanceUpdateInput {
  checkInTime: Date;
  checkOutTime: Date;
  status: AttendanceStatus;
  totalWorkMinutes: number;
  overtimeMinutes: number;
  isLate: boolean;
  lateMinutes: number;
  isEarlyDeparture: boolean;
  earlyDepartureMinutes: number;
  regularizationId: Types.ObjectId | string;
}

export interface BreakSessionResponse {
  startTime: Date;
  endTime: Date | null;
  durationMinutes: number | null;
  type: BreakType;
  note?: string;
}

export interface ShiftSnapshotResponse {
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
  gracePeriodMinutes: number;
  minWorkMinutesForFullDay: number;
  minWorkMinutesForHalfDay: number;
  overtimeThresholdMinutes: number;
}

export interface AttendanceResponse {
  id: string;
  employeeId: string;
  attendanceDate: string;
  date: Date;
  shiftId: string;
  shiftSnapshot: ShiftSnapshotResponse;
  checkInTime: Date | null;
  checkOutTime: Date | null;
  status: AttendanceStatus;
  attendanceType: AttendanceType;
  breaks: BreakSessionResponse[];
  totalBreakMinutes: number;
  totalWorkMinutes: number;
  isLate: boolean;
  lateMinutes: number;
  isEarlyDeparture: boolean;
  earlyDepartureMinutes: number;
  overtimeMinutes: number;
  checkInSource: AttendanceSource;
  checkOutSource?: AttendanceSource;
  checkInNotes?: string;
  checkOutNotes?: string;
  regularizationId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TodayAttendanceStatusResponse {
  isCheckedIn: boolean;
  isOnBreak: boolean;
  attendance: AttendanceResponse | null;
}

export class AttendanceMapper {
  /**
   * Maps request and calculation data to persistence input for creating an attendance record.
   */
  static toCreateData(input: CreateAttendanceInput): Partial<Attendance> {
    return {
      employeeId:
        input.employeeId instanceof Types.ObjectId
          ? input.employeeId
          : new Types.ObjectId(input.employeeId),
      attendanceDate: input.attendanceDate,
      date: input.date,
      shiftId:
        input.shiftId instanceof Types.ObjectId
          ? input.shiftId
          : new Types.ObjectId(input.shiftId),
      shiftSnapshot: {
        name: input.shiftSnapshot.name,
        code: input.shiftSnapshot.code,
        startTime: input.shiftSnapshot.startTime,
        endTime: input.shiftSnapshot.endTime,
        isOvernight: input.shiftSnapshot.isOvernight,
        gracePeriodMinutes: input.shiftSnapshot.gracePeriodMinutes,
        minWorkMinutesForFullDay: input.shiftSnapshot.minWorkMinutesForFullDay,
        minWorkMinutesForHalfDay: input.shiftSnapshot.minWorkMinutesForHalfDay,
        overtimeThresholdMinutes: input.shiftSnapshot.overtimeThresholdMinutes,
      },
      checkInTime: input.checkInTime,
      checkOutTime: null,
      status: input.status ?? AttendanceStatus.CHECKED_IN,
      attendanceType: input.attendanceType ?? AttendanceType.REGULAR,
      breaks: input.breaks ?? [],
      totalBreakMinutes: 0,
      totalWorkMinutes: 0,
      isLate: input.isLate ?? false,
      lateMinutes: input.lateMinutes ?? 0,
      isEarlyDeparture: false,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 0,
      checkInSource: input.checkInSource ?? AttendanceSource.WEB,
      checkInIp: input.checkInIp,
      checkInLocation: input.checkInLocation,
      checkInNotes: input.checkInNotes?.trim(),
      regularizationId: input.regularizationId
        ? input.regularizationId instanceof Types.ObjectId
          ? input.regularizationId
          : new Types.ObjectId(input.regularizationId)
        : null,
    };
  }

  /**
   * Maps check-out inputs and calculations to persistence update data.
   */
  static toCheckOutUpdateData(
    input: CheckOutUpdateInput,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {
      checkOutTime: input.checkOutTime,
      status: input.status,
      breaks: input.breaks,
      totalBreakMinutes: input.totalBreakMinutes,
      totalWorkMinutes: input.totalWorkMinutes,
      overtimeMinutes: input.overtimeMinutes,
      isEarlyDeparture: input.isEarlyDeparture,
      earlyDepartureMinutes: input.earlyDepartureMinutes,
      checkOutSource: input.checkOutSource ?? AttendanceSource.WEB,
    };

    if (input.checkOutIp !== undefined) data.checkOutIp = input.checkOutIp;
    if (input.checkOutLocation !== undefined)
      data.checkOutLocation = input.checkOutLocation;
    if (input.checkOutNotes !== undefined)
      data.checkOutNotes = input.checkOutNotes.trim();

    return data;
  }

  /**
   * Maps regularization approval calculation to persistence update data.
   */
  static toRegularizedUpdateData(
    input: RegularizedAttendanceUpdateInput,
  ): Record<string, unknown> {
    return {
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      status: input.status,
      totalWorkMinutes: input.totalWorkMinutes,
      overtimeMinutes: input.overtimeMinutes,
      isLate: input.isLate,
      lateMinutes: input.lateMinutes,
      isEarlyDeparture: input.isEarlyDeparture,
      earlyDepartureMinutes: input.earlyDepartureMinutes,
      regularizationId:
        input.regularizationId instanceof Types.ObjectId
          ? input.regularizationId
          : new Types.ObjectId(input.regularizationId),
    };
  }

  /**
   * Maps an Attendance entity/lean document to an API response DTO.
   */
  static toResponse(doc: AttendanceLean): AttendanceResponse {
    return {
      id: doc._id.toString(),
      employeeId: doc.employeeId.toString(),
      attendanceDate: doc.attendanceDate,
      date: doc.date,
      shiftId: doc.shiftId.toString(),
      shiftSnapshot: {
        name: doc.shiftSnapshot.name,
        code: doc.shiftSnapshot.code,
        startTime: doc.shiftSnapshot.startTime,
        endTime: doc.shiftSnapshot.endTime,
        isOvernight: doc.shiftSnapshot.isOvernight,
        gracePeriodMinutes: doc.shiftSnapshot.gracePeriodMinutes,
        minWorkMinutesForFullDay: doc.shiftSnapshot.minWorkMinutesForFullDay,
        minWorkMinutesForHalfDay: doc.shiftSnapshot.minWorkMinutesForHalfDay,
        overtimeThresholdMinutes: doc.shiftSnapshot.overtimeThresholdMinutes,
      },
      checkInTime: doc.checkInTime,
      checkOutTime: doc.checkOutTime,
      status: doc.status,
      attendanceType: doc.attendanceType,
      breaks: (doc.breaks || []).map((b) => ({
        startTime: b.startTime,
        endTime: b.endTime,
        durationMinutes: b.durationMinutes,
        type: b.type,
        note: b.note,
      })),
      totalBreakMinutes: doc.totalBreakMinutes ?? 0,
      totalWorkMinutes: doc.totalWorkMinutes ?? 0,
      isLate: doc.isLate ?? false,
      lateMinutes: doc.lateMinutes ?? 0,
      isEarlyDeparture: doc.isEarlyDeparture ?? false,
      earlyDepartureMinutes: doc.earlyDepartureMinutes ?? 0,
      overtimeMinutes: doc.overtimeMinutes ?? 0,
      checkInSource: doc.checkInSource,
      checkOutSource: doc.checkOutSource,
      checkInNotes: doc.checkInNotes,
      checkOutNotes: doc.checkOutNotes,
      regularizationId: doc.regularizationId
        ? doc.regularizationId.toString()
        : null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  static toResponseList(attendances: AttendanceLean[]): AttendanceResponse[] {
    return attendances.map((a) => AttendanceMapper.toResponse(a));
  }

  static toTodayStatus(
    attendance: AttendanceLean | null,
  ): TodayAttendanceStatusResponse {
    if (!attendance) {
      return {
        isCheckedIn: false,
        isOnBreak: false,
        attendance: null,
      };
    }

    return {
      isCheckedIn:
        attendance.status === AttendanceStatus.CHECKED_IN ||
        attendance.status === AttendanceStatus.ON_BREAK,
      isOnBreak: attendance.status === AttendanceStatus.ON_BREAK,
      attendance: AttendanceMapper.toResponse(attendance),
    };
  }
}

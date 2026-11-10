import { Types } from 'mongoose';
import {
  ATTENDANCE_CONSTANTS,
  AttendanceSource,
  AttendanceStatus,
  BreakType,
  WorkMode,
} from '../constants/attendance.constant';
import { AttendanceLean } from '../repositories/attendance.repository';
import {
  Attendance,
  BreakSession,
  DeviceInfo,
  GeoLocation,
  ShiftSnapshot,
} from '../schemas/attendance.schema';
import { CheckInDto, GeoLocationDto } from '../dto/check-in.dto';
import { CheckOutDto } from '../dto/check-out.dto';
import { StartBreakDto } from '../dto/start-break.dto';
import { AttendanceCalculationUtil } from '../utils/attendance-calculation.util';

export interface ShiftSnapshotSource {
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
  gracePeriodMinutes: number;
  breakDurationMinutes?: number;
  minWorkMinutesForFullDay: number;
  minWorkMinutesForHalfDay: number;
  overtimeThresholdMinutes: number;
}

export interface CheckInCreateInput {
  employeeId: Types.ObjectId | string;
  attendanceDate: string;
  shift: ShiftSnapshotSource & { _id: Types.ObjectId | string };
  checkInTime: Date;
  isLate: boolean;
  lateMinutes: number;
  dto: CheckInDto;
  ipAddress?: string | null;
  resolvedSource?: AttendanceSource;
  geofenceResult?: {
    isWithinGeofence: boolean | null;
    isGeofenceVerified: boolean;
    isIpVerified: boolean;
    distanceMeters: number | null;
  } | null;
}

export interface CreateAttendanceInput {
  employeeId: Types.ObjectId | string;
  attendanceDate: string;
  date: Date;
  shiftId: Types.ObjectId | string;
  shiftSnapshot: ShiftSnapshot;
  checkInTime: Date;
  status?: AttendanceStatus;
  workMode?: WorkMode;
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
  dto?: CheckOutDto;
  ipAddress?: string | null;
  checkOutSource?: AttendanceSource;
  checkOutIp?: string | null;
  checkOutLocation?: GeoLocationDto | GeoLocation;
  checkOutNotes?: string;
}

export interface RegularizedAttendanceCreateInput {
  employeeId: Types.ObjectId | string;
  attendanceDate: string;
  shift: ShiftSnapshotSource & { _id: Types.ObjectId | string };
  checkInTime: Date;
  checkOutTime: Date;
  status?: AttendanceStatus;
  totalBreakMinutes?: number;
  totalWorkMinutes: number;
  overtimeMinutes: number;
  isLate: boolean;
  lateMinutes: number;
  isEarlyDeparture: boolean;
  earlyDepartureMinutes: number;
  regularizationId: Types.ObjectId | string;
  checkInSource?: AttendanceSource;
  checkOutSource?: AttendanceSource;
}

export interface RegularizedAttendanceUpdateInput {
  checkInTime: Date;
  checkOutTime: Date;
  status: AttendanceStatus;
  totalBreakMinutes?: number;
  totalWorkMinutes: number;
  overtimeMinutes: number;
  isLate: boolean;
  lateMinutes: number;
  isEarlyDeparture: boolean;
  earlyDepartureMinutes: number;
  regularizationId: Types.ObjectId | string;
}

export interface BreakSessionResponse {
  startTime: string | Date;
  endTime: string | Date | null;
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
  breakDurationMinutes?: number;
  minWorkMinutesForFullDay: number;
  minWorkMinutesForHalfDay: number;
  overtimeThresholdMinutes: number;
}

export interface AttendanceResponse {
  id: string;
  employeeId: string;
  attendanceDate: string;
  date: string | Date;
  shiftId: string;
  shiftSnapshot: ShiftSnapshotResponse;
  checkInTime: string | Date | null;
  checkOutTime: string | Date | null;
  status: AttendanceStatus;
  workMode: WorkMode;
  attendanceType?: string;
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
  checkInLocation?: GeoLocation;
  checkOutLocation?: GeoLocation;
  checkInDeviceInfo?: DeviceInfo;
  checkOutDeviceInfo?: DeviceInfo;
  checkInNotes?: string;
  checkOutNotes?: string;
  regularizationId: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface TodayAttendanceStatusResponse {
  isCheckedIn: boolean;
  isOnBreak: boolean;
  attendance: AttendanceResponse | null;
}

export class AttendanceMapper {
  /**
   * Transforms shift configuration into an embedded ShiftSnapshot schema document.
   */
  static toShiftSnapshot(shift: ShiftSnapshotSource): ShiftSnapshot {
    return {
      name: shift.name,
      code: shift.code,
      startTime: shift.startTime,
      endTime: shift.endTime,
      isOvernight: shift.isOvernight,
      gracePeriodMinutes: shift.gracePeriodMinutes,
      breakDurationMinutes:
        shift.breakDurationMinutes ??
        ATTENDANCE_CONSTANTS.DEFAULT_BREAK_DURATION_MINUTES,
      minWorkMinutesForFullDay: shift.minWorkMinutesForFullDay,
      minWorkMinutesForHalfDay: shift.minWorkMinutesForHalfDay,
      overtimeThresholdMinutes: shift.overtimeThresholdMinutes,
    };
  }

  /**
   * Transforms break start DTO into an embedded BreakSession document.
   */
  static toBreakSession(
    dto: StartBreakDto,
    startTime: Date = new Date(),
  ): BreakSession {
    return {
      startTime,
      endTime: null,
      durationMinutes: null,
      type: dto.type ?? BreakType.LUNCH,
      note: dto.note?.trim(),
    };
  }

  /**
   * Maps check-in context, DTO, and calculations into a persistence document for creation.
   */
  static toCheckInCreateData(input: CheckInCreateInput): Partial<Attendance> {
    const shiftSnapshot = AttendanceMapper.toShiftSnapshot(input.shift);

    let resolvedWorkMode = input.dto.workMode ?? WorkMode.OFFICE;
    if (
      (input.dto.attendanceType as string) === 'WORK_FROM_HOME' ||
      input.dto.workMode === WorkMode.WORK_FROM_HOME
    ) {
      resolvedWorkMode = WorkMode.WORK_FROM_HOME;
    } else if (
      (input.dto.attendanceType as string) === 'ON_DUTY' ||
      input.dto.workMode === WorkMode.ON_DUTY
    ) {
      resolvedWorkMode = WorkMode.ON_DUTY;
    }

    const checkInLocation: GeoLocation | undefined = input.dto.location
      ? {
          latitude: input.dto.location.latitude,
          longitude: input.dto.location.longitude,
          accuracyMeters: input.dto.location.accuracyMeters,
          address: input.dto.location.address?.trim(),
          isWithinGeofence: input.geofenceResult?.isWithinGeofence ?? null,
          isGeofenceVerified: input.geofenceResult?.isGeofenceVerified ?? false,
          isIpVerified: input.geofenceResult?.isIpVerified ?? false,
          distanceMeters: input.geofenceResult?.distanceMeters ?? null,
        }
      : input.geofenceResult
        ? {
            isWithinGeofence: input.geofenceResult.isWithinGeofence ?? null,
            isGeofenceVerified: input.geofenceResult.isGeofenceVerified,
            isIpVerified: input.geofenceResult.isIpVerified,
            distanceMeters: input.geofenceResult.distanceMeters,
          }
        : undefined;

    const sanitizedNotes = input.dto.notes
      ? input.dto.notes
          .replace(/<[^>]*>/g, '')
          .trim()
          .slice(0, 200)
      : undefined;

    return {
      employeeId:
        input.employeeId instanceof Types.ObjectId
          ? input.employeeId
          : new Types.ObjectId(input.employeeId),
      attendanceDate: input.attendanceDate,
      date: AttendanceCalculationUtil.getNormalizedDate(input.attendanceDate),
      shiftId:
        input.shift._id instanceof Types.ObjectId
          ? input.shift._id
          : new Types.ObjectId(input.shift._id),
      shiftSnapshot,
      checkInTime: input.checkInTime,
      checkOutTime: null,
      status: AttendanceStatus.CHECKED_IN,
      workMode: resolvedWorkMode,
      breaks: [],
      totalBreakMinutes: 0,
      totalWorkMinutes: 0,
      isLate: input.isLate,
      lateMinutes: input.lateMinutes,
      isEarlyDeparture: false,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 0,
      checkInSource:
        input.resolvedSource ?? input.dto.source ?? AttendanceSource.WEB,
      checkInIp: input.ipAddress || undefined,
      checkInLocation,
      checkInNotes: sanitizedNotes,
      checkInDeviceInfo: input.dto.deviceInfo,
      regularizationId: null,
    };
  }

  /**
   * Maps general creation data to persistence input for creating an attendance record.
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
      workMode: input.workMode ?? WorkMode.OFFICE,
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
   * Maps check-out inputs and calculations to persistence update dictionary.
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
      checkOutSource:
        input.dto?.source ?? input.checkOutSource ?? AttendanceSource.WEB,
    };

    const ip = input.ipAddress || input.checkOutIp;
    if (ip) data.checkOutIp = ip;

    const loc = input.dto?.location ?? input.checkOutLocation;
    if (loc !== undefined) data.checkOutLocation = loc;

    const notes = input.dto?.notes?.trim() ?? input.checkOutNotes?.trim();
    if (notes !== undefined) data.checkOutNotes = notes;

    if (input.dto?.deviceInfo !== undefined) {
      data.checkOutDeviceInfo = input.dto.deviceInfo;
    }

    return data;
  }

  /**
   * Maps a new regularized attendance record (when employee was absent and regularization approved) to persistence input.
   */
  static toRegularizedCreateData(
    input: RegularizedAttendanceCreateInput,
  ): Partial<Attendance> {
    return {
      employeeId:
        input.employeeId instanceof Types.ObjectId
          ? input.employeeId
          : new Types.ObjectId(input.employeeId),
      attendanceDate: input.attendanceDate,
      date: AttendanceCalculationUtil.getNormalizedDate(input.attendanceDate),
      shiftId:
        input.shift._id instanceof Types.ObjectId
          ? input.shift._id
          : new Types.ObjectId(input.shift._id),
      shiftSnapshot: AttendanceMapper.toShiftSnapshot(input.shift),
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      status: input.status ?? AttendanceStatus.REGULARIZED,
      workMode: WorkMode.OFFICE,
      breaks: [],
      totalBreakMinutes: input.totalBreakMinutes ?? 0,
      totalWorkMinutes: input.totalWorkMinutes,
      overtimeMinutes: input.overtimeMinutes,
      isLate: input.isLate,
      lateMinutes: input.lateMinutes,
      isEarlyDeparture: input.isEarlyDeparture,
      earlyDepartureMinutes: input.earlyDepartureMinutes,
      checkInSource: input.checkInSource ?? AttendanceSource.SYSTEM,
      checkOutSource: input.checkOutSource ?? AttendanceSource.SYSTEM,
      regularizationId:
        input.regularizationId instanceof Types.ObjectId
          ? input.regularizationId
          : new Types.ObjectId(input.regularizationId),
    };
  }

  /**
   * Maps regularization approval calculation to persistence update dictionary for existing record.
   */
  static toRegularizedUpdateData(
    input: RegularizedAttendanceUpdateInput,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {
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

    if (input.totalBreakMinutes !== undefined) {
      data.totalBreakMinutes = input.totalBreakMinutes;
    }

    return data;
  }

  /**
   * Maps an Attendance entity/lean document to an API response DTO.
   */
  static toResponse(doc: AttendanceLean): AttendanceResponse {
    return {
      id: doc._id.toString(),
      employeeId: doc.employeeId.toString(),
      attendanceDate: doc.attendanceDate,
      date:
        AttendanceCalculationUtil.formatZonedISO(
          AttendanceCalculationUtil.getNormalizedDate(doc.attendanceDate),
        ) ?? doc.attendanceDate,
      shiftId: doc.shiftId.toString(),
      shiftSnapshot: {
        name: doc.shiftSnapshot.name,
        code: doc.shiftSnapshot.code,
        startTime: doc.shiftSnapshot.startTime,
        endTime: doc.shiftSnapshot.endTime,
        isOvernight: doc.shiftSnapshot.isOvernight,
        gracePeriodMinutes: doc.shiftSnapshot.gracePeriodMinutes,
        breakDurationMinutes:
          doc.shiftSnapshot.breakDurationMinutes ??
          ATTENDANCE_CONSTANTS.DEFAULT_BREAK_DURATION_MINUTES,
        minWorkMinutesForFullDay: doc.shiftSnapshot.minWorkMinutesForFullDay,
        minWorkMinutesForHalfDay: doc.shiftSnapshot.minWorkMinutesForHalfDay,
        overtimeThresholdMinutes: doc.shiftSnapshot.overtimeThresholdMinutes,
      },
      checkInTime: AttendanceCalculationUtil.formatZonedISO(doc.checkInTime),
      checkOutTime: AttendanceCalculationUtil.formatZonedISO(doc.checkOutTime),
      status: doc.status,
      workMode: doc.workMode ?? WorkMode.OFFICE,
      attendanceType: doc.workMode ?? WorkMode.OFFICE,
      breaks: (doc.breaks || []).map((b) => ({
        startTime:
          AttendanceCalculationUtil.formatZonedISO(b.startTime) ??
          b.startTime.toISOString(),
        endTime: AttendanceCalculationUtil.formatZonedISO(b.endTime),
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
      checkInLocation: doc.checkInLocation,
      checkOutLocation: doc.checkOutLocation,
      checkInDeviceInfo: doc.checkInDeviceInfo,
      checkOutDeviceInfo: doc.checkOutDeviceInfo,
      checkInNotes: doc.checkInNotes,
      checkOutNotes: doc.checkOutNotes,
      regularizationId: doc.regularizationId
        ? doc.regularizationId.toString()
        : null,
      createdAt:
        AttendanceCalculationUtil.formatZonedISO(doc.createdAt) ?? undefined,
      updatedAt:
        AttendanceCalculationUtil.formatZonedISO(doc.updatedAt) ?? undefined,
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

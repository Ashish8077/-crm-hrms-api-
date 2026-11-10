import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import {
  AttendanceLean,
  AttendanceRepository,
  MonthlyAttendanceSummary,
} from '../repositories/attendance.repository';
import {
  AttendanceRegularizationLean,
  AttendanceRegularizationRepository,
} from '../repositories/attendance-regularization.repository';
import {
  EmployeeLean,
  EmployeeRepository,
} from '../../employees/repositories/employee.repository';
import { BranchRepository } from '../../branches/repositories/branch.repository';
import { ActiveEmploymentStatuses } from '../../employees/constants/employee.constant';
import { ShiftService } from './shift.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import {
  ATTENDANCE_CONSTANTS,
  AttendanceSource,
  AttendanceStatus,
  RegularizationStatus,
  WorkMode,
} from '../constants/attendance.constant';
import {
  AttendanceCalculationUtil,
  ShiftCalculationParams,
} from '../utils/attendance-calculation.util';
import { CheckInDto } from '../dto/check-in.dto';
import { AdminManualAttendanceDto } from '../dto/admin-manual-attendance.dto';
import { CheckOutDto } from '../dto/check-out.dto';
import { StartBreakDto } from '../dto/start-break.dto';
import { EndBreakDto } from '../dto/end-break.dto';
import { CreateRegularizationDto } from '../dto/create-regularization.dto';
import { ReviewRegularizationDto } from '../dto/review-regularization.dto';
import { RejectRegularizationDto } from '../dto/reject-regularization.dto';
import { ListAttendanceQueryDto } from '../dto/list-attendance-query.dto';
import { AttendanceCalendarQueryDto } from '../dto/attendance-calendar-query.dto';
import { AttendanceSummaryQueryDto } from '../dto/attendance-summary-query.dto';
import { ListRegularizationQueryDto } from '../dto/list-regularization-query.dto';
import {
  AttendanceMapper,
  AttendanceResponse,
  ShiftSnapshotSource,
  TodayAttendanceStatusResponse,
} from '../mappers/attendance.mapper';
import {
  AttendanceRegularizationMapper,
  AttendanceRegularizationResponse,
} from '../mappers/attendance-regularization.mapper';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ClientMetadata } from '../../../common/types/client-metadata.type';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { AuthorizationService } from '../../authorization/authorization.service';
import { PermissionKeys } from '../../permissions/constants/permission.constant';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly attendanceRepository: AttendanceRepository,
    private readonly regularizationRepository: AttendanceRegularizationRepository,
    private readonly employeeRepository: EmployeeRepository,
    private readonly branchRepository: BranchRepository,
    private readonly shiftService: ShiftService,
    private readonly auditLogsService: AuditLogsService,
    private readonly authorizationService: AuthorizationService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Helper to resolve the authenticated user's Employee record.
   */
  private async getEmployeeForUser(
    userId: Types.ObjectId,
  ): Promise<EmployeeLean> {
    const employee = await this.employeeRepository.findByUserId(userId);
    if (!employee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee profile not found for authenticated user',
        HttpStatus.NOT_FOUND,
      );
    }
    return employee;
  }

  /**
   * Centralized business rule verifying an employee's employment eligibility
   * for recording attendance operations (check-in, check-out, break start/end, regularization).
   */
  private validateAttendanceEligibility(
    employee: EmployeeLean,
    currentDate: Date = new Date(),
  ): void {
    const attendanceDateStr = AttendanceCalculationUtil.getAttendanceDateString(
      currentDate,
      ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
    );

    // 1. Effective start date: cannot record attendance before dateOfJoining
    if (employee.dateOfJoining) {
      const joiningDateStr = AttendanceCalculationUtil.getAttendanceDateString(
        employee.dateOfJoining,
        ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
      );
      if (attendanceDateStr < joiningDateStr) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Employee is not eligible to record attendance before joining date',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // 2. Effective end date: if lastWorkingDate, resignationDate, or terminationDate is defined
    const effectiveEndDate =
      (
        employee as {
          lastWorkingDate?: Date;
          resignationDate?: Date;
          terminationDate?: Date;
        }
      ).lastWorkingDate ??
      (employee as { resignationDate?: Date }).resignationDate ??
      (employee as { terminationDate?: Date }).terminationDate;

    if (effectiveEndDate) {
      const endDateStr = AttendanceCalculationUtil.getAttendanceDateString(
        effectiveEndDate,
        ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
      );
      if (attendanceDateStr > endDateStr) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Employee is not eligible to record attendance after effective end date',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // 3. Status rule: ACTIVE, PROBATION, NOTICE_PERIOD are allowed; TERMINATED, RESIGNED are rejected
    if (!ActiveEmploymentStatuses.includes(employee.employmentStatus)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Employee is not eligible to record attendance',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Helper to detect MongoDB unique compound index duplicate key error (code 11000).
   * Covers native driver, MongoServerError, MongoBulkWriteError, and nested transaction causes.
   */
  private isMongoDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const err = error as Record<string, unknown>;
    if (err.code === 11000) {
      return true;
    }
    if (typeof err.message === 'string' && err.message.includes('E11000')) {
      return true;
    }
    if (err.name === 'MongoServerError' && err.code === 11000) {
      return true;
    }
    if (err.name === 'MongoBulkWriteError' && err.code === 11000) {
      return true;
    }
    if (err.cause && typeof err.cause === 'object') {
      const cause = err.cause as Record<string, unknown>;
      if (
        cause.code === 11000 ||
        (typeof cause.message === 'string' && cause.message.includes('E11000'))
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolves the authenticated user's Employee record and validates employment eligibility for attendance.
   */
  private async getEligibleEmployeeForAttendance(
    userId: Types.ObjectId,
    currentDate: Date = new Date(),
  ): Promise<EmployeeLean> {
    const employee = await this.getEmployeeForUser(userId);
    this.validateAttendanceEligibility(employee, currentDate);
    return employee;
  }

  /**
   * Resolves the active attendance session for an employee.
   * If today's attendance record is active (CHECKED_IN or ON_BREAK), returns it.
   * Otherwise, checks for an unclosed active session across midnight (e.g. overnight shift from yesterday).
   * Falls back to today's completed record or null.
   */
  private async resolveActiveOrTodayAttendance(
    employeeId: Types.ObjectId,
    todayDateStr: string,
  ): Promise<AttendanceLean | null> {
    const todayAttendance =
      await this.attendanceRepository.findByEmployeeAndDate(
        employeeId,
        todayDateStr,
      );

    if (
      todayAttendance &&
      (todayAttendance.status === AttendanceStatus.CHECKED_IN ||
        todayAttendance.status === AttendanceStatus.ON_BREAK)
    ) {
      return todayAttendance;
    }

    const activeSession =
      await this.attendanceRepository.findActiveSessionByEmployee(employeeId);
    if (activeSession) {
      return activeSession;
    }

    return todayAttendance;
  }

  /**
   * Employee check-in workflow.
   */
  async checkIn(
    actorId: Types.ObjectId,
    dto: CheckInDto,
    metadata: ClientMetadata,
  ): Promise<AttendanceResponse> {
    const now = new Date();
    const employee = await this.getEligibleEmployeeForAttendance(actorId, now);

    // Resolve employee branch to determine local branch timezone for canonical date string
    const branch = employee.branchId
      ? await this.branchRepository.findById(employee.branchId)
      : null;
    const branchTimezone =
      branch?.timezone || ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE;

    // Layer 1: Canonical "YYYY-MM-DD" date string resolved in employee's branch timezone
    const attendanceDate = AttendanceCalculationUtil.getAttendanceDateString(
      now,
      branchTimezone,
    );

    // 1. Fast pre-check for existing record today (avoids unnecessary shift/geofence computation)
    const existing = await this.attendanceRepository.findByEmployeeAndDate(
      employee._id,
      attendanceDate,
    );
    if (existing) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Already checked in for today (${attendanceDate})`,
        HttpStatus.CONFLICT,
      );
    }

    const activeSession =
      await this.attendanceRepository.findActiveSessionByEmployee(employee._id);
    if (activeSession) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `You have an active check-in session in progress from ${activeSession.attendanceDate}. Please check out before checking in again.`,
        HttpStatus.CONFLICT,
      );
    }

    // 2. Resolve shift via strict 4-Step Hierarchy:
    // Production Rule: Completely ignore client-supplied dto.shiftId during employee self-punch.
    // An employee cannot select their own shift from Postman/app to dodge late marking.
    const shift = await this.shiftService.resolveShift(employee.shiftId, null, {
      employeeId: employee._id,
      attendanceDate,
      isAdminOverride: false,
    });

    // Normalize legacy attendanceType to workMode if workMode was not specified
    if (!dto.workMode && dto.attendanceType) {
      dto.workMode =
        dto.attendanceType === 'REGULAR'
          ? WorkMode.OFFICE
          : (dto.attendanceType as WorkMode);
    }

    // 3. Validate workMode authorization (Production Rule: cannot pass WFH/OD to bypass office geofencing)
    const isRemoteRequested =
      dto.workMode === WorkMode.WORK_FROM_HOME ||
      dto.workMode === WorkMode.ON_DUTY;

    if (isRemoteRequested) {
      if (!employee.isRemoteAllowed) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          `Remote work (${dto.workMode}) is not authorized for this employee. Please punch in with workMode OFFICE or obtain remote work approval.`,
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // 4. Source & Network/Geofence Verification
    // Production Rule: Avoid Desktop GPS Trap (desktops lack GPS chips; navigator.geolocation is 2-10km off).
    // WEB punches enforce office Wi-Fi / static IP whitelist; MOBILE punches enforce GPS geofencing.
    const isMobileDevice =
      Boolean(dto.deviceInfo?.deviceId) ||
      /Mobile|Android|iPhone|iPad/i.test(metadata.userAgent || '') ||
      dto.source === AttendanceSource.MOBILE;
    const resolvedSource = isMobileDevice
      ? AttendanceSource.MOBILE
      : AttendanceSource.WEB;

    let geofenceResult:
      | {
          isWithinGeofence: boolean | null;
          isGeofenceVerified: boolean;
          isIpVerified: boolean;
          distanceMeters: number | null;
        }
      | undefined;

    if (!isRemoteRequested) {
      if (!branch) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'No office branch assigned to this employee.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const branchAllowedIps = branch.allowedIps ?? [];
      const isIpMatched = AttendanceCalculationUtil.isIpAllowed(
        metadata.ipAddress,
        branchAllowedIps,
      );

      // CASE 2A: WEB PUNCH -> Enforce Office Wi-Fi / Static IP Whitelist
      if (resolvedSource === AttendanceSource.WEB) {
        const enforceIp = branch.enforceIpCheck !== false;

        if (enforceIp && branchAllowedIps.length > 0 && !isIpMatched) {
          throw new AppError(
            ErrorCode.FORBIDDEN,
            `Web punch-in restricted to office Wi-Fi network. Your IP (${metadata.ipAddress ?? 'unknown'}) is not authorized.`,
            HttpStatus.FORBIDDEN,
          );
        }

        geofenceResult = {
          isWithinGeofence: false,
          isGeofenceVerified: false,
          isIpVerified: enforceIp ? isIpMatched : true,
          distanceMeters: null,
        };
      } else {
        // CASE 2B: MOBILE PUNCH -> Enforce GPS Geofence
        if (
          !dto.location ||
          typeof dto.location.latitude !== 'number' ||
          typeof dto.location.longitude !== 'number'
        ) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'GPS coordinates (latitude and longitude) are required for mobile punch-in.',
            HttpStatus.BAD_REQUEST,
          );
        }

        // Reject weak/cell-tower GPS locks (prevents false jumps & cheap spoofing)
        if (dto.location.accuracyMeters && dto.location.accuracyMeters > 100) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `GPS signal is too weak (accuracy: ${Math.round(dto.location.accuracyMeters)}m). Step near a window and retry.`,
            HttpStatus.BAD_REQUEST,
          );
        }

        if (branch.latitude != null && branch.longitude != null) {
          const allowedRadius = branch.radiusMeters ?? 150;
          const distance = AttendanceCalculationUtil.calculateHaversineDistance(
            dto.location.latitude,
            dto.location.longitude,
            branch.latitude,
            branch.longitude,
          );

          if (distance > allowedRadius) {
            throw new AppError(
              ErrorCode.FORBIDDEN,
              `You are ${distance}m away from ${branch.name}. Must be within ${allowedRadius}m to punch in.`,
              HttpStatus.FORBIDDEN,
            );
          }

          geofenceResult = {
            isWithinGeofence: true,
            isGeofenceVerified: true,
            isIpVerified: isIpMatched,
            distanceMeters: distance,
          };
        } else {
          geofenceResult = {
            isWithinGeofence: true,
            isGeofenceVerified: true,
            isIpVerified: isIpMatched,
            distanceMeters: null,
          };
        }
      }
    } else {
      geofenceResult = {
        isWithinGeofence: false,
        isGeofenceVerified: false,
        isIpVerified: false,
        distanceMeters: null,
      };
    }

    // 5. Snapshot shift and compute late marking
    const shiftParams: ShiftCalculationParams = {
      startTime: shift.startTime,
      endTime: shift.endTime,
      isOvernight: shift.isOvernight,
      gracePeriodMinutes: shift.gracePeriodMinutes,
      minWorkMinutesForFullDay: shift.minWorkMinutesForFullDay,
      minWorkMinutesForHalfDay: shift.minWorkMinutesForHalfDay,
      overtimeThresholdMinutes: shift.overtimeThresholdMinutes,
    };

    const shiftWindow = AttendanceCalculationUtil.getShiftWindow(
      attendanceDate,
      shiftParams,
    );
    const lateCalc = AttendanceCalculationUtil.calculateLate(now, shiftWindow);

    const session = await this.connection.startSession();
    let saved: AttendanceLean;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const createData = AttendanceMapper.toCheckInCreateData({
          employeeId: employee._id,
          attendanceDate,
          shift,
          checkInTime: now,
          isLate: lateCalc.isLate,
          lateMinutes: lateCalc.lateMinutes,
          dto,
          ipAddress: metadata.ipAddress,
          resolvedSource,
          geofenceResult,
        });

        saved = await this.attendanceRepository.create(createData, s);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ATTENDANCE_CHECK_IN,
            targetId: saved._id,
            targetModel: AuditTargetModel.ATTENDANCE,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: {
              attendanceDate,
              isLate: lateCalc.isLate,
              lateMinutes: lateCalc.lateMinutes,
            },
          },
          s,
        );
      });
    } catch (error: unknown) {
      if (this.isMongoDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Already checked in for today (${attendanceDate})`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }

    return AttendanceMapper.toResponse(saved!);
  }

  /**
   * Admin / HR Manual Attendance Entry workflow.
   * Allows authorized HR/Admin to manually record or backdate attendance.
   * Only in this workflow is an explicit shiftId override accepted and validated against active shifts.
   */
  async recordManualAttendance(
    actorId: Types.ObjectId,
    dto: AdminManualAttendanceDto,
    metadata: ClientMetadata,
  ): Promise<AttendanceResponse> {
    const hasAdminPermission =
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.ATTENDANCE_CREATE,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.ATTENDANCE_EDIT,
      ));

    if (!hasAdminPermission) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Insufficient permissions to manually record employee attendance',
        HttpStatus.FORBIDDEN,
      );
    }

    const targetEmployeeId = new Types.ObjectId(dto.employeeId);
    const targetEmployee =
      await this.employeeRepository.findById(targetEmployeeId);
    if (!targetEmployee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Target employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    this.validateAttendanceEligibility(
      targetEmployee,
      new Date(dto.attendanceDate),
    );

    const existing = await this.attendanceRepository.findByEmployeeAndDate(
      targetEmployee._id,
      dto.attendanceDate,
    );
    if (existing) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Attendance record already exists for ${dto.attendanceDate}`,
        HttpStatus.CONFLICT,
      );
    }

    // Step 1: In Admin Manual Entry, explicit shiftId IS accepted and validated
    const shift = await this.shiftService.resolveShift(
      targetEmployee.shiftId,
      dto.shiftId ? new Types.ObjectId(dto.shiftId) : null,
      {
        employeeId: targetEmployee._id,
        attendanceDate: dto.attendanceDate,
        isAdminOverride: true,
      },
    );

    const checkInTime = AttendanceCalculationUtil.parsePunchTimestamp(
      dto.checkInTime,
      dto.attendanceDate,
    );
    if (!checkInTime) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'checkInTime is an invalid date string',
        HttpStatus.BAD_REQUEST,
      );
    }

    const checkOutTime = dto.checkOutTime
      ? AttendanceCalculationUtil.parsePunchTimestamp(
          dto.checkOutTime,
          dto.attendanceDate,
        )
      : null;
    if (dto.checkOutTime && !checkOutTime) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'checkOutTime is an invalid date string',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (checkOutTime && checkInTime.getTime() >= checkOutTime.getTime()) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'checkInTime must be earlier than checkOutTime',
        HttpStatus.BAD_REQUEST,
      );
    }

    const shiftParams: ShiftCalculationParams = {
      startTime: shift.startTime,
      endTime: shift.endTime,
      isOvernight: shift.isOvernight,
      gracePeriodMinutes: shift.gracePeriodMinutes,
      minWorkMinutesForFullDay: shift.minWorkMinutesForFullDay,
      minWorkMinutesForHalfDay: shift.minWorkMinutesForHalfDay,
      overtimeThresholdMinutes: shift.overtimeThresholdMinutes,
    };

    const shiftWindow = AttendanceCalculationUtil.getShiftWindow(
      dto.attendanceDate,
      shiftParams,
    );
    const lateCalc = AttendanceCalculationUtil.calculateLate(
      checkInTime,
      shiftWindow,
    );

    let totalWorkMinutes = 0;
    let overtimeMinutes = 0;
    let earlyCalc = { isEarlyDeparture: false, earlyDepartureMinutes: 0 };
    let dayStatus = AttendanceStatus.CHECKED_IN;

    if (checkOutTime) {
      earlyCalc = AttendanceCalculationUtil.calculateEarlyDeparture(
        checkOutTime,
        shiftWindow,
      );
      const workCalc = AttendanceCalculationUtil.calculateWorkAndOvertime(
        checkInTime,
        checkOutTime,
        0,
        shiftParams.overtimeThresholdMinutes,
      );
      totalWorkMinutes = workCalc.totalWorkMinutes;
      overtimeMinutes = workCalc.overtimeMinutes;
      dayStatus = AttendanceCalculationUtil.determineAttendanceStatus(
        totalWorkMinutes,
        shiftParams.minWorkMinutesForFullDay,
        shiftParams.minWorkMinutesForHalfDay,
      );
    }

    const session = await this.connection.startSession();
    let saved: AttendanceLean;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const resolvedWorkMode =
          dto.workMode ??
          (dto.attendanceType === 'WORK_FROM_HOME'
            ? WorkMode.WORK_FROM_HOME
            : dto.attendanceType === 'ON_DUTY'
              ? WorkMode.ON_DUTY
              : WorkMode.OFFICE);

        const createData = AttendanceMapper.toCheckInCreateData({
          employeeId: targetEmployee._id,
          attendanceDate: dto.attendanceDate,
          shift,
          checkInTime,
          isLate: lateCalc.isLate,
          lateMinutes: lateCalc.lateMinutes,
          dto: {
            workMode: resolvedWorkMode,
            source: AttendanceSource.ADMIN_MANUAL,
            notes: dto.notes,
          },
          ipAddress: metadata.ipAddress,
        });

        if (checkOutTime) {
          createData.checkOutTime = checkOutTime;
          createData.status = dayStatus;
          createData.totalWorkMinutes = totalWorkMinutes;
          createData.overtimeMinutes = overtimeMinutes;
          createData.isEarlyDeparture = earlyCalc.isEarlyDeparture;
          createData.earlyDepartureMinutes = earlyCalc.earlyDepartureMinutes;
          createData.checkOutSource = AttendanceSource.SYSTEM;
        }

        saved = await this.attendanceRepository.create(createData, s);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ATTENDANCE_CHECK_IN,
            targetId: saved._id,
            targetModel: AuditTargetModel.ATTENDANCE,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: {
              attendanceDate: dto.attendanceDate,
              isManualEntry: true,
              shiftId: shift._id.toString(),
              shiftCode: shift.code,
            },
          },
          s,
        );
      });
    } catch (error: unknown) {
      if (this.isMongoDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Attendance already recorded for date (${dto.attendanceDate})`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }

    return AttendanceMapper.toResponse(saved!);
  }

  /**
   * Employee check-out workflow.
   */
  async checkOut(
    actorId: Types.ObjectId,
    dto: CheckOutDto,
    metadata: ClientMetadata,
  ): Promise<AttendanceResponse> {
    const now = new Date();
    const employee = await this.getEligibleEmployeeForAttendance(actorId, now);
    const attendanceDate = AttendanceCalculationUtil.getAttendanceDateString(
      now,
      ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
    );

    const attendance = await this.resolveActiveOrTodayAttendance(
      employee._id,
      attendanceDate,
    );

    if (!attendance) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `No active attendance check-in found for today (${attendanceDate})`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      attendance.status !== AttendanceStatus.CHECKED_IN &&
      attendance.status !== AttendanceStatus.ON_BREAK
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot check out from current status: ${attendance.status}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!attendance.checkInTime) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Attendance check-in time is missing',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Layer 3: Multi-punch cooldown guard (anti-double-tap)
    const cooldownMs = ATTENDANCE_CONSTANTS.PUNCH_COOLDOWN_SECONDS * 1000;
    if (now.getTime() - attendance.checkInTime.getTime() < cooldownMs) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot check out within ${ATTENDANCE_CONSTANTS.PUNCH_COOLDOWN_SECONDS} seconds of checking in. Please wait before checking out.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Step 1: Validate and Auto-Close Open Breaks First
    const updatedBreaks = [...(attendance.breaks || [])];
    const openBreakIndex = updatedBreaks.findIndex((b) => !b.endTime);
    if (openBreakIndex !== -1) {
      const openBreak = updatedBreaks[openBreakIndex];
      const duration = AttendanceCalculationUtil.calculateDurationMinutes(
        openBreak.startTime,
        now,
      );
      updatedBreaks[openBreakIndex] = {
        ...openBreak,
        endTime: now,
        durationMinutes: duration,
      };
    }

    // Step 2: High-precision break duration across entire array (second-level math)
    const breakDurations =
      AttendanceCalculationUtil.calculateBreakDurations(updatedBreaks);
    const totalBreakMinutes = breakDurations.totalBreakMinutes;

    const shiftParams: ShiftCalculationParams = {
      startTime: attendance.shiftSnapshot.startTime,
      endTime: attendance.shiftSnapshot.endTime,
      isOvernight: attendance.shiftSnapshot.isOvernight,
      gracePeriodMinutes: attendance.shiftSnapshot.gracePeriodMinutes,
      minWorkMinutesForFullDay:
        attendance.shiftSnapshot.minWorkMinutesForFullDay,
      minWorkMinutesForHalfDay:
        attendance.shiftSnapshot.minWorkMinutesForHalfDay,
      overtimeThresholdMinutes:
        attendance.shiftSnapshot.overtimeThresholdMinutes,
    };

    // Step 3: Shift Window & Early Departure Evaluation
    const shiftWindow = AttendanceCalculationUtil.getShiftWindow(
      attendance.attendanceDate,
      shiftParams,
    );
    const earlyCalc = AttendanceCalculationUtil.calculateEarlyDeparture(
      now,
      shiftWindow,
    );

    // Step 4: Net Work & Overtime Calculation (Gross seconds - Break seconds -> net minutes)
    const workCalc = AttendanceCalculationUtil.calculateWorkAndOvertime(
      attendance.checkInTime,
      now,
      breakDurations,
      shiftParams.overtimeThresholdMinutes,
    );

    // Step 5: Full-Day / Half-Day / Incomplete Status Determination (Option B)
    const dayStatus = AttendanceCalculationUtil.determineAttendanceStatus(
      workCalc.totalWorkMinutes,
      shiftParams.minWorkMinutesForFullDay,
      shiftParams.minWorkMinutesForHalfDay,
    );

    const session = await this.connection.startSession();
    let updated: AttendanceLean | null = null;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const updateData = AttendanceMapper.toCheckOutUpdateData({
          checkOutTime: now,
          status: dayStatus,
          breaks: updatedBreaks,
          totalBreakMinutes,
          totalWorkMinutes: workCalc.totalWorkMinutes,
          overtimeMinutes: workCalc.overtimeMinutes,
          isEarlyDeparture: earlyCalc.isEarlyDeparture,
          earlyDepartureMinutes: earlyCalc.earlyDepartureMinutes,
          dto,
          ipAddress: metadata.ipAddress,
        });

        updated = await this.attendanceRepository.checkOutSession(
          attendance._id,
          updateData,
          s,
        );

        if (!updated) {
          throw new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            'Attendance has already been checked out or active session is no longer valid.',
            HttpStatus.CONFLICT,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ATTENDANCE_CHECK_OUT,
            targetId: attendance._id,
            targetModel: AuditTargetModel.ATTENDANCE,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: {
              attendanceDate: attendance.attendanceDate,
              totalWorkMinutes: workCalc.totalWorkMinutes,
              dayStatus,
            },
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    return AttendanceMapper.toResponse(updated!);
  }

  /**
   * Start break workflow.
   */
  async startBreak(
    actorId: Types.ObjectId,
    dto: StartBreakDto,
    metadata: ClientMetadata,
  ): Promise<AttendanceResponse> {
    const now = new Date();
    const employee = await this.getEligibleEmployeeForAttendance(actorId, now);
    const attendanceDate = AttendanceCalculationUtil.getAttendanceDateString(
      now,
      ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
    );

    const attendance = await this.resolveActiveOrTodayAttendance(
      employee._id,
      attendanceDate,
    );

    if (!attendance) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Cannot start break without active check-in',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (attendance.status === AttendanceStatus.ON_BREAK) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Already on an active break',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (attendance.status !== AttendanceStatus.CHECKED_IN) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot start break from status: ${attendance.status}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      (attendance.breaks || []).length >=
      ATTENDANCE_CONSTANTS.MAX_BREAKS_PER_DAY
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Maximum break limit of ${ATTENDANCE_CONSTANTS.MAX_BREAKS_PER_DAY} reached for today`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const breakSession = AttendanceMapper.toBreakSession(dto, now);

    const session = await this.connection.startSession();
    let updated: AttendanceLean | null = null;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        updated = await this.attendanceRepository.startBreak(
          attendance._id,
          breakSession,
          s,
        );

        if (!updated) {
          throw new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            'Cannot start break. Either attendance status has changed or break already started.',
            HttpStatus.CONFLICT,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ATTENDANCE_BREAK_START,
            targetId: attendance._id,
            targetModel: AuditTargetModel.ATTENDANCE,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: { breakType: breakSession.type },
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    return AttendanceMapper.toResponse(updated!);
  }

  /**
   * End break workflow.
   */
  async endBreak(
    actorId: Types.ObjectId,
    dto: EndBreakDto,
    metadata: ClientMetadata,
  ): Promise<AttendanceResponse> {
    const now = new Date();
    const employee = await this.getEligibleEmployeeForAttendance(actorId, now);
    const attendanceDate = AttendanceCalculationUtil.getAttendanceDateString(
      now,
      ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
    );

    const attendance = await this.resolveActiveOrTodayAttendance(
      employee._id,
      attendanceDate,
    );

    if (!attendance || attendance.status !== AttendanceStatus.ON_BREAK) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'No active break found to end',
        HttpStatus.BAD_REQUEST,
      );
    }

    const activeBreak = attendance.breaks.find((b) => !b.endTime);
    if (!activeBreak) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Active break session not found',
        HttpStatus.BAD_REQUEST,
      );
    }

    const breakDuration = AttendanceCalculationUtil.calculateDurationMinutes(
      activeBreak.startTime,
      now,
    );
    const totalBreakMinutes =
      (attendance.totalBreakMinutes || 0) + breakDuration;

    const session = await this.connection.startSession();
    let updated: AttendanceLean | null = null;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        updated = await this.attendanceRepository.endActiveBreak(
          attendance._id,
          now,
          breakDuration,
          totalBreakMinutes,
          s,
          dto.note?.trim(),
        );

        if (!updated) {
          throw new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            'No active break found to end or break has already ended.',
            HttpStatus.CONFLICT,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ATTENDANCE_BREAK_END,
            targetId: attendance._id,
            targetModel: AuditTargetModel.ATTENDANCE,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: { durationMinutes: breakDuration, totalBreakMinutes },
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    return AttendanceMapper.toResponse(updated!);
  }

  /**
   * Today status query.
   */
  async getTodayStatus(
    actorId: Types.ObjectId,
  ): Promise<TodayAttendanceStatusResponse> {
    const now = new Date();
    const employee = await this.getEligibleEmployeeForAttendance(actorId, now);
    const attendanceDate = AttendanceCalculationUtil.getAttendanceDateString(
      now,
      ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
    );

    const attendance = await this.resolveActiveOrTodayAttendance(
      employee._id,
      attendanceDate,
    );

    return AttendanceMapper.toTodayStatus(attendance);
  }

  /**
   * Calendar query with reporting manager and permission authorization checks.
   */
  async getCalendar(
    actorId: Types.ObjectId,
    query: AttendanceCalendarQueryDto,
  ): Promise<AttendanceResponse[]> {
    const currentEmployee = await this.getEmployeeForUser(actorId);
    let targetEmployeeId = currentEmployee._id;

    if (
      query.employeeId &&
      query.employeeId !== currentEmployee._id.toString()
    ) {
      targetEmployeeId = new Types.ObjectId(query.employeeId);
      const targetEmployee =
        await this.employeeRepository.findById(targetEmployeeId);
      if (!targetEmployee) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Target employee not found',
          HttpStatus.NOT_FOUND,
        );
      }

      // Check manager or permission authorization
      const isManager =
        targetEmployee.reportingManagerId &&
        targetEmployee.reportingManagerId.toString() ===
          currentEmployee._id.toString();

      const hasViewPermission = await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.ATTENDANCE_VIEW,
      );

      if (!isManager && !hasViewPermission) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Insufficient permission to view employee attendance calendar',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    const records = await this.attendanceRepository.findCalendar(
      targetEmployeeId,
      query.startDate,
      query.endDate,
    );

    return AttendanceMapper.toResponseList(records);
  }

  /**
   * Monthly summary statistics.
   */
  async getMonthlySummary(
    actorId: Types.ObjectId,
    query: AttendanceSummaryQueryDto,
  ): Promise<MonthlyAttendanceSummary> {
    const currentEmployee = await this.getEmployeeForUser(actorId);
    let targetEmployeeId = currentEmployee._id;

    if (
      query.employeeId &&
      query.employeeId !== currentEmployee._id.toString()
    ) {
      targetEmployeeId = new Types.ObjectId(query.employeeId);
      const targetEmployee =
        await this.employeeRepository.findById(targetEmployeeId);
      if (!targetEmployee) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Target employee not found',
          HttpStatus.NOT_FOUND,
        );
      }

      const isManager =
        targetEmployee.reportingManagerId &&
        targetEmployee.reportingManagerId.toString() ===
          currentEmployee._id.toString();

      const hasViewPermission = await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.ATTENDANCE_VIEW,
      );

      if (!isManager && !hasViewPermission) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Insufficient permission to view employee attendance summary',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    const monthStr = String(query.month).padStart(2, '0');
    const startDate = `${query.year}-${monthStr}-01`;
    // Find last day of month
    const lastDay = new Date(Date.UTC(query.year, query.month, 0)).getUTCDate();
    const endDate = `${query.year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

    return this.attendanceRepository.getMonthlySummary(
      targetEmployeeId,
      startDate,
      endDate,
    );
  }

  /**
   * Create attendance regularization request.
   */
  async createRegularization(
    actorId: Types.ObjectId,
    dto: CreateRegularizationDto,
    metadata: ClientMetadata,
  ): Promise<AttendanceRegularizationResponse> {
    const employee = await this.getEligibleEmployeeForAttendance(actorId);
    const now = new Date();
    const branch = employee.branchId
      ? await this.branchRepository.findById(employee.branchId)
      : null;
    const timeZone = branch?.timezone || ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE;
    const todayStr = AttendanceCalculationUtil.getAttendanceDateString(
      now,
      timeZone,
    );

    // ─── Guard 1: The Future Date Block ───
    if (dto.attendanceDate > todayStr) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot regularize attendance for a future date (${dto.attendanceDate}). Future dates cannot be regularized.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // ─── Guard 2: The Payroll Lockout Window (SLA) ───
    const diffDays = AttendanceCalculationUtil.calculateCalendarDayDifference(
      todayStr,
      dto.attendanceDate,
    );
    const maxPastDays = ATTENDANCE_CONSTANTS.REGULARIZATION_MAX_PAST_DAYS;
    if (diffDays > maxPastDays) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Regularization window expired. Attendance date (${dto.attendanceDate}) is ${diffDays} days in the past, exceeding the maximum allowed window of ${maxPastDays} days due to payroll lockout rules.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 1. Resolve existing attendance record (if any)
    let attendance: AttendanceLean | null = null;
    if (dto.attendanceId) {
      attendance = await this.attendanceRepository.findById(dto.attendanceId);
      if (
        !attendance ||
        attendance.employeeId.toString() !== employee._id.toString()
      ) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Associated attendance record not found for employee',
          HttpStatus.NOT_FOUND,
        );
      }
      if (attendance.attendanceDate !== dto.attendanceDate) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'attendanceDate does not match the provided attendance record date',
          HttpStatus.BAD_REQUEST,
        );
      }
    } else {
      attendance = await this.attendanceRepository.findByEmployeeAndDate(
        employee._id,
        dto.attendanceDate,
      );
    }

    // ─── Guard 5: Roster & Holiday Check ───
    // Regularization is strictly allowed on scheduled working days, not on Weekly Offs (Sunday) or Company Holidays
    const isWeeklyOff =
      AttendanceCalculationUtil.isWeeklyOff(dto.attendanceDate) ||
      attendance?.status === AttendanceStatus.WEEK_OFF;
    const isHoliday = attendance?.status === AttendanceStatus.HOLIDAY;
    const isOnLeave = attendance?.status === AttendanceStatus.ON_LEAVE;

    if (isWeeklyOff || isHoliday || isOnLeave) {
      const reasonType = isHoliday
        ? 'company holiday'
        : isOnLeave
          ? 'approved leave'
          : 'weekly off';
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot regularize attendance on a ${reasonType} (${dto.attendanceDate}). Regularization is only permitted on scheduled working days. Please submit a Comp-Off or Overtime request instead.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // ─── Guard 6: The "Double Dip" Prevention ───
    // Prohibit duplicate active/pending regularization requests for the same date
    const existingPending =
      await this.regularizationRepository.findPendingByEmployeeAndDate(
        employee._id,
        dto.attendanceDate,
      );

    if (existingPending) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `A pending regularization request already exists for date ${dto.attendanceDate}. Duplicate requests are not permitted.`,
        HttpStatus.CONFLICT,
      );
    }

    // ─── Guard 7: Existing Status Validation ───
    // If an attendance record exists, verify it actually needs regularization.
    // Full Day PRESENT records cannot be regularized; only ABSENT, INCOMPLETE, HALF_DAY, or missing punch records.
    if (attendance) {
      if (attendance.status === AttendanceStatus.PRESENT) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Attendance for date ${dto.attendanceDate} is already marked as PRESENT (Full Day). Regularization is only applicable for ABSENT, INCOMPLETE, HALF_DAY, or missing punch records.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      if (attendance.status === AttendanceStatus.REGULARIZED) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Attendance for date ${dto.attendanceDate} has already been regularized and approved. Further regularization requests are not allowed.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // ─── Resolve Shift Parameters for Window & Validation ───
    let shiftParams: ShiftCalculationParams;
    if (attendance && attendance.shiftSnapshot) {
      shiftParams = {
        startTime: attendance.shiftSnapshot.startTime,
        endTime: attendance.shiftSnapshot.endTime,
        isOvernight: attendance.shiftSnapshot.isOvernight,
        gracePeriodMinutes: attendance.shiftSnapshot.gracePeriodMinutes,
        minWorkMinutesForFullDay:
          attendance.shiftSnapshot.minWorkMinutesForFullDay,
        minWorkMinutesForHalfDay:
          attendance.shiftSnapshot.minWorkMinutesForHalfDay,
        overtimeThresholdMinutes:
          attendance.shiftSnapshot.overtimeThresholdMinutes,
      };
    } else {
      const resolvedShift = await this.shiftService.resolveShift(
        employee.shiftId,
        null,
        {
          employeeId: employee._id,
          attendanceDate: dto.attendanceDate,
        },
      );
      shiftParams = {
        startTime: resolvedShift.startTime,
        endTime: resolvedShift.endTime,
        isOvernight: resolvedShift.isOvernight,
        gracePeriodMinutes: resolvedShift.gracePeriodMinutes,
        minWorkMinutesForFullDay: resolvedShift.minWorkMinutesForFullDay,
        minWorkMinutesForHalfDay: resolvedShift.minWorkMinutesForHalfDay,
        overtimeThresholdMinutes: resolvedShift.overtimeThresholdMinutes,
      };
    }

    const shiftWindow = AttendanceCalculationUtil.getShiftWindow(
      dto.attendanceDate,
      shiftParams,
      timeZone,
    );

    // If regularizing for today, scheduled shift must have ended
    if (dto.attendanceDate === todayStr) {
      if (now.getTime() < shiftWindow.shiftEnd.getTime()) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Cannot regularize attendance for today before the scheduled shift has ended',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // ─── Resolve Requested Punch Timestamps ───
    const originalCheckInTime = attendance?.checkInTime ?? null;
    const originalCheckOutTime = attendance?.checkOutTime ?? null;

    if (!dto.requestedCheckInTime && !dto.requestedCheckOutTime) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'At least one of requestedCheckInTime or requestedCheckOutTime must be provided',
        HttpStatus.BAD_REQUEST,
      );
    }

    const checkOutTargetDate = shiftParams.isOvernight
      ? AttendanceCalculationUtil.getNextDateString(dto.attendanceDate)
      : dto.attendanceDate;

    const reqIn = dto.requestedCheckInTime
      ? AttendanceCalculationUtil.parsePunchTimestamp(
          dto.requestedCheckInTime,
          dto.attendanceDate,
          timeZone,
        )
      : null;
    const reqOut = dto.requestedCheckOutTime
      ? AttendanceCalculationUtil.parsePunchTimestamp(
          dto.requestedCheckOutTime,
          checkOutTargetDate,
          timeZone,
        )
      : null;

    if (dto.requestedCheckInTime && !reqIn) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'requestedCheckInTime is an invalid date string',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.requestedCheckOutTime && !reqOut) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'requestedCheckOutTime is an invalid date string',
        HttpStatus.BAD_REQUEST,
      );
    }

    const effectiveCheckIn = reqIn ?? originalCheckInTime;
    const effectiveCheckOut = reqOut ?? originalCheckOutTime;

    if (!effectiveCheckIn) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'No check-in timestamp found. Please provide requestedCheckInTime',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!effectiveCheckOut) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'No check-out timestamp found. Please provide requestedCheckOutTime',
        HttpStatus.BAD_REQUEST,
      );
    }

    // ─── Guard 4: Timestamp to Date Alignment ───
    if (reqIn) {
      if (
        typeof dto.requestedCheckInTime === 'string' &&
        dto.requestedCheckInTime.trim().endsWith('Z')
      ) {
        const rawMatch = dto.requestedCheckInTime.match(/T(\d{2}):(\d{2})/);
        if (rawMatch && shiftParams.startTime.startsWith(rawMatch[1])) {
          this.logger.warn(
            `[AttendanceRegularization] Potential timezone trap detected for employee ${employee._id.toString()}: payload timestamp "${dto.requestedCheckInTime}" has UTC hour "${rawMatch[1]}" matching shift start "${shiftParams.startTime}", which converts to ${AttendanceCalculationUtil.formatZonedISO(reqIn, timeZone)} in ${timeZone}. Prefer passing simple time ("${shiftParams.startTime}") or local naive datetime.`,
          );
        }
      }

      const checkInLocalDate =
        AttendanceCalculationUtil.getAttendanceDateString(reqIn, timeZone);
      if (checkInLocalDate !== dto.attendanceDate) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `requestedCheckInTime falls on ${checkInLocalDate} in ${timeZone}, which does not match attendanceDate (${dto.attendanceDate}).`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    if (reqOut) {
      const checkOutLocalDate =
        AttendanceCalculationUtil.getAttendanceDateString(reqOut, timeZone);
      const nextDateStr = AttendanceCalculationUtil.getNextDateString(
        dto.attendanceDate,
      );
      const isAllowedCheckOutDate = shiftParams.isOvernight
        ? checkOutLocalDate === dto.attendanceDate ||
          checkOutLocalDate === nextDateStr
        : checkOutLocalDate === dto.attendanceDate;

      if (!isAllowedCheckOutDate) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `requestedCheckOutTime falls on ${checkOutLocalDate} in ${timeZone}, which does not match attendanceDate (${dto.attendanceDate})${shiftParams.isOvernight ? ` or overnight next day (${nextDateStr})` : ''}.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // ─── Guard 3: Chronology Check (Time Travel Block) ───
    if (effectiveCheckIn.getTime() >= effectiveCheckOut.getTime()) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'requestedCheckOutTime must be strictly later than requestedCheckInTime. Check-out time cannot precede or equal check-in time.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      effectiveCheckOut.getTime() - effectiveCheckIn.getTime() >
      24 * 60 * 60 * 1000
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Total duration between check-in and check-out cannot exceed 24 hours',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      effectiveCheckIn.getTime() > now.getTime() ||
      effectiveCheckOut.getTime() > now.getTime()
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Requested punch timestamps cannot be in the future',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Shift boundary buffer check (within +/- 6h of shift window)
    const allowableWindowStart = new Date(
      shiftWindow.shiftStart.getTime() - 6 * 60 * 60 * 1000,
    );
    const allowableWindowEnd = new Date(
      shiftWindow.shiftEnd.getTime() + 6 * 60 * 60 * 1000,
    );

    if (
      effectiveCheckIn < allowableWindowStart ||
      effectiveCheckIn > allowableWindowEnd ||
      effectiveCheckOut < allowableWindowStart ||
      effectiveCheckOut > allowableWindowEnd
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Requested punch times fall outside the allowable 24-hour shift window for this attendance date',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 8. Database Execution (The Audit Trail)
    const session = await this.connection.startSession();
    let created: AttendanceRegularizationLean;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        const createData = AttendanceRegularizationMapper.toCreateData(
          dto,
          employee._id,
          attendance ? attendance._id : null,
          originalCheckInTime,
          originalCheckOutTime,
          effectiveCheckIn,
          effectiveCheckOut,
        );

        created = await this.regularizationRepository.create(createData, s);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ATTENDANCE_REGULARIZATION_REQUESTED,
            targetId: created._id,
            targetModel: AuditTargetModel.ATTENDANCE_REGULARIZATION,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: {
              attendanceDate: dto.attendanceDate,
              reason: dto.reason,
              type: createData.type,
              requestedCheckInTime: effectiveCheckIn,
              requestedCheckOutTime: effectiveCheckOut,
              originalCheckInTime,
              originalCheckOutTime,
            },
          },
          s,
        );
      });
    } catch (error: unknown) {
      if (this.isMongoDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `A pending regularization request already exists for date ${dto.attendanceDate}`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }

    // =========================================================================
    // TODO: [Notification / Queue Integration] - Regularization Request Submitted
    // =========================================================================
    // Place notification dispatch here (outside the DB transaction to prevent
    // holding open MongoDB connections or sending emails on rolled-back transactions).
    //
    // Implementation Blueprint for next AI / Developer:
    // 1. Target Recipients:
    //    - Employee's Reporting Manager: employee.reportingManagerId (via EmployeeRepository)
    //    - HR Department / Attendance Admins: Users with ATTENDANCE_APPROVE permission
    // 2. Notification Channels:
    //    - Email: Manager action request with employee name, date, requested times, and direct action links
    //    - Push Notification: FCM / WebPush notification to manager mobile & web dashboard
    // 3. Recommended Dispatch Pattern:
    //    await this.eventEmitter.emitAsync('attendance.regularization.created', {
    //      eventId: uuidv4(),
    //      eventType: 'ATTENDANCE_REGULARIZATION_CREATED',
    //      timestamp: new Date().toISOString(),
    //      recipientIds: [
    //        ...(employee.reportingManagerId ? [employee.reportingManagerId.toString()] : []),
    //      ],
    //      data: {
    //        regularizationId: created!._id.toString(),
    //        employeeId: employee._id.toString(),
    //        employeeName: `${employee.firstName} ${employee.lastName}`,
    //        attendanceDate: dto.attendanceDate,
    //        type: created!.type,
    //        reason: created!.reason,
    //        requestedCheckInTime: effectiveCheckIn.toISOString(),
    //        requestedCheckOutTime: effectiveCheckOut.toISOString(),
    //        originalCheckInTime: originalCheckInTime ? originalCheckInTime.toISOString() : null,
    //        originalCheckOutTime: originalCheckOutTime ? originalCheckOutTime.toISOString() : null,
    //      },
    //      actionUrls: {
    //        approveUrl: `/api/v1/attendance/regularizations/${created!._id}/approve`,
    //        rejectUrl: `/api/v1/attendance/regularizations/${created!._id}/reject`,
    //        webDashboardUrl: `/dashboard/attendance/regularizations/${created!._id}`,
    //      },
    //    });
    // =========================================================================

    return AttendanceRegularizationMapper.toResponse(created!);
  }

  /**
   * List regularization requests.
   */
  async listRegularizations(
    actorId: Types.ObjectId,
    query: ListRegularizationQueryDto,
  ): Promise<PaginatedResult<AttendanceRegularizationResponse>> {
    const currentEmployee = await this.getEmployeeForUser(actorId);
    const hasApprovePermission = await this.authorizationService.hasPermission(
      actorId,
      PermissionKeys.ATTENDANCE_APPROVE,
    );

    const filter: Record<string, unknown> = {};

    if (query.employeeId) {
      filter.employeeId = new Types.ObjectId(query.employeeId);
    } else if (!hasApprovePermission) {
      // Regular employees can only see their own requests by default
      filter.employeeId = currentEmployee._id;
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.startDate || query.endDate) {
      const dateFilter: Record<string, string> = {};
      if (query.startDate) dateFilter.$gte = query.startDate;
      if (query.endDate) dateFilter.$lte = query.endDate;
      filter.attendanceDate = dateFilter;
    }

    const result = await this.regularizationRepository.findList(
      filter,
      query.page || 1,
      query.limit || 20,
    );

    return {
      data: AttendanceRegularizationMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }

  /**
   * Approve attendance regularization request.
   * Enforces self-approval restriction, recalculates net hours with high-precision math,
   * updates status (upgraded from INCOMPLETE to PRESENT or HALF_DAY), and links regularizationId.
   */
  async approveRegularization(
    id: Types.ObjectId,
    actorId: Types.ObjectId,
    dto: ReviewRegularizationDto,
    metadata: ClientMetadata,
  ): Promise<AttendanceRegularizationResponse> {
    const regularization = await this.regularizationRepository.findById(id);
    if (!regularization) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Regularization request not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // THE STATE LOCK - Prevents double approvals
    if (regularization.status !== RegularizationStatus.PENDING) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Cannot process. Request is already ${regularization.status}`,
        HttpStatus.CONFLICT,
      );
    }

    const approverEmployee = await this.getEmployeeForUser(actorId);

    // INVARIANT: Self-approval prohibited
    if (
      regularization.employeeId.toString() === approverEmployee._id.toString()
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Self-approval of regularization requests is strictly prohibited',
        HttpStatus.FORBIDDEN,
      );
    }

    // Verify manager relationship or approval permission
    const requestedEmployee = await this.employeeRepository.findById(
      regularization.employeeId,
    );
    if (!requestedEmployee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee associated with regularization request not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const isReportingManager =
      requestedEmployee.reportingManagerId &&
      requestedEmployee.reportingManagerId.toString() ===
        approverEmployee._id.toString();

    const hasApprovePermission = await this.authorizationService.hasPermission(
      actorId,
      PermissionKeys.ATTENDANCE_APPROVE,
    );

    if (!isReportingManager && !hasApprovePermission) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'You are not authorized to approve this employee regularization request',
        HttpStatus.FORBIDDEN,
      );
    }

    const effectiveRemarks = ReviewRegularizationDto.resolveRemarks(dto);

    const session = await this.connection.startSession();
    let updatedReg: AttendanceRegularizationLean | null = null;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        // 1. Update regularization status to APPROVED
        updatedReg = await this.regularizationRepository.updateStatus(
          id,
          RegularizationStatus.APPROVED,
          actorId,
          new Date(),
          effectiveRemarks,
          s,
        );

        if (!updatedReg) {
          throw new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            'Cannot process. Request state changed concurrently or is no longer pending',
            HttpStatus.CONFLICT,
          );
        }

        // 2. Resolve shift and recalculate attendance
        const attendance =
          await this.attendanceRepository.findByEmployeeAndDate(
            regularization.employeeId,
            regularization.attendanceDate,
            s,
          );

        // Snapshot Rule: If an attendance record already exists, use its frozen shiftSnapshot!
        // This guarantees past attendance calculations and historical payroll records
        // are never corrupted even if HR alters shift configurations in the future.
        let shiftParams: ShiftCalculationParams;
        let shift: ShiftSnapshotSource & { _id: Types.ObjectId | string };

        if (attendance && attendance.shiftSnapshot) {
          shift = {
            ...attendance.shiftSnapshot,
            _id: attendance.shiftId,
          };
          shiftParams = {
            startTime: attendance.shiftSnapshot.startTime,
            endTime: attendance.shiftSnapshot.endTime,
            isOvernight: attendance.shiftSnapshot.isOvernight,
            gracePeriodMinutes: attendance.shiftSnapshot.gracePeriodMinutes,
            minWorkMinutesForFullDay:
              attendance.shiftSnapshot.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay:
              attendance.shiftSnapshot.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes:
              attendance.shiftSnapshot.overtimeThresholdMinutes,
          };
        } else {
          const resolvedShift = await this.shiftService.resolveShift(
            requestedEmployee.shiftId,
            null,
            {
              employeeId: requestedEmployee._id,
              attendanceDate: regularization.attendanceDate,
              isAdminOverride: true,
            },
          );
          shift = resolvedShift;
          shiftParams = {
            startTime: resolvedShift.startTime,
            endTime: resolvedShift.endTime,
            isOvernight: resolvedShift.isOvernight,
            gracePeriodMinutes: resolvedShift.gracePeriodMinutes,
            minWorkMinutesForFullDay: resolvedShift.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay: resolvedShift.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes: resolvedShift.overtimeThresholdMinutes,
          };
        }

        const effectiveCheckIn =
          regularization.requestedCheckInTime ?? attendance?.checkInTime;
        const effectiveCheckOut =
          regularization.requestedCheckOutTime ?? attendance?.checkOutTime;

        if (!effectiveCheckIn || !effectiveCheckOut) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Missing check-in or check-out timestamp for regularization recalculation',
            HttpStatus.BAD_REQUEST,
          );
        }

        const branch = requestedEmployee.branchId
          ? await this.branchRepository.findById(requestedEmployee.branchId)
          : null;
        const timeZone =
          branch?.timezone || ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE;

        const shiftWindow = AttendanceCalculationUtil.getShiftWindow(
          regularization.attendanceDate,
          shiftParams,
          timeZone,
        );
        const lateCalc = AttendanceCalculationUtil.calculateLate(
          effectiveCheckIn,
          shiftWindow,
        );
        const earlyCalc = AttendanceCalculationUtil.calculateEarlyDeparture(
          effectiveCheckOut,
          shiftWindow,
        );

        // Regularization Break Deduction Rule:
        // During regularization, use shiftSnapshot.breakDurationMinutes as the baseline break deduction
        // when no actual break records exist. For regularized absent days (no attendance record)
        // or incomplete days (no recorded breaks), using 0 breaks would inflate totalWorkMinutes
        // and could incorrectly promote HALF_DAY → PRESENT.
        // If the employee had actual recorded breaks, use whichever is greater:
        // the recorded breaks or the shift's configured break duration.
        const actualBreakMinutes = attendance
          ? AttendanceCalculationUtil.calculateTotalBreakMinutes(
              attendance.breaks || [],
            )
          : 0;

        const shiftBreakMinutes =
          attendance?.shiftSnapshot?.breakDurationMinutes ??
          shift.breakDurationMinutes ??
          ATTENDANCE_CONSTANTS.DEFAULT_BREAK_DURATION_MINUTES;

        // Use the greater of actual recorded breaks vs shift-configured break duration.
        // This ensures regularized records always deduct at least the shift's standard break,
        // while respecting longer actual breaks if they were recorded.
        const totalBreakMinutes = Math.max(
          actualBreakMinutes,
          shiftBreakMinutes,
        );

        const workCalc = AttendanceCalculationUtil.calculateWorkAndOvertime(
          effectiveCheckIn,
          effectiveCheckOut,
          totalBreakMinutes,
          shiftParams.overtimeThresholdMinutes,
        );

        // Status Update: Evaluate new totalWorkMinutes against full-day & half-day thresholds
        // Upgrades status from INCOMPLETE to PRESENT or HALF_DAY
        const calculatedStatus =
          AttendanceCalculationUtil.determineAttendanceStatus(
            workCalc.totalWorkMinutes,
            shiftParams,
          );

        if (attendance) {
          // Update existing attendance record through mapper
          const updateData = AttendanceMapper.toRegularizedUpdateData({
            checkInTime: effectiveCheckIn,
            checkOutTime: effectiveCheckOut,
            status: calculatedStatus,
            totalBreakMinutes,
            totalWorkMinutes: workCalc.totalWorkMinutes,
            overtimeMinutes: workCalc.overtimeMinutes,
            isLate: lateCalc.isLate,
            lateMinutes: lateCalc.lateMinutes,
            isEarlyDeparture: earlyCalc.isEarlyDeparture,
            earlyDepartureMinutes: earlyCalc.earlyDepartureMinutes,
            regularizationId: id,
          });

          await this.attendanceRepository.updateById(
            attendance._id,
            updateData,
            s,
          );
        } else {
          // Create new regularized attendance record through mapper
          const createData = AttendanceMapper.toRegularizedCreateData({
            employeeId: regularization.employeeId,
            attendanceDate: regularization.attendanceDate,
            shift,
            checkInTime: effectiveCheckIn,
            checkOutTime: effectiveCheckOut,
            status: calculatedStatus,
            totalBreakMinutes,
            totalWorkMinutes: workCalc.totalWorkMinutes,
            overtimeMinutes: workCalc.overtimeMinutes,
            isLate: lateCalc.isLate,
            lateMinutes: lateCalc.lateMinutes,
            isEarlyDeparture: earlyCalc.isEarlyDeparture,
            earlyDepartureMinutes: earlyCalc.earlyDepartureMinutes,
            regularizationId: id,
          });

          await this.attendanceRepository.create(createData, s);
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ATTENDANCE_REGULARIZATION_APPROVED,
            targetId: id,
            targetModel: AuditTargetModel.ATTENDANCE_REGULARIZATION,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: {
              attendanceDate: regularization.attendanceDate,
              employeeId: regularization.employeeId,
              status: calculatedStatus,
              totalWorkMinutes: workCalc.totalWorkMinutes,
              reviewRemarks: effectiveRemarks,
            },
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    // =========================================================================
    // TODO: [Notification / Queue Integration] - Regularization Request Approved
    // =========================================================================
    // Place notification dispatch here (outside DB transaction).
    //
    // Implementation Blueprint for next AI / Developer:
    // 1. Target Recipients:
    //    - Requesting Employee: regularization.employeeId
    // 2. Notification Channels:
    //    - Email: Regularization approval notice with updated attendance card & work hours
    //    - Push Notification: FCM notification: "Your attendance regularization for {date} was approved"
    // 3. Recommended Dispatch Pattern:
    //    await this.eventEmitter.emitAsync('attendance.regularization.approved', {
    //      eventId: uuidv4(),
    //      eventType: 'ATTENDANCE_REGULARIZATION_APPROVED',
    //      timestamp: new Date().toISOString(),
    //      recipientIds: [regularization.employeeId.toString()],
    //      data: {
    //        regularizationId: id.toString(),
    //        attendanceDate: regularization.attendanceDate,
    //        reviewedBy: approverEmployee._id.toString(),
    //        approverName: `${approverEmployee.firstName} ${approverEmployee.lastName}`,
    //        reviewRemarks: effectiveRemarks ?? null,
    //      },
    //      metadata: {
    //        notificationTitle: 'Attendance Regularization Approved',
    //        notificationBody: `Your attendance for ${regularization.attendanceDate} has been regularized and approved.`,
    //        webDashboardUrl: `/dashboard/attendance?date=${regularization.attendanceDate}`,
    //      },
    //    });
    // =========================================================================

    return AttendanceRegularizationMapper.toResponse(updatedReg!);
  }

  /**
   * Reject attendance regularization request.
   */
  async rejectRegularization(
    id: Types.ObjectId,
    actorId: Types.ObjectId,
    dto: ReviewRegularizationDto | RejectRegularizationDto,
    metadata: ClientMetadata,
  ): Promise<AttendanceRegularizationResponse> {
    const regularization = await this.regularizationRepository.findById(id);
    if (!regularization) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Regularization request not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // THE STATE LOCK - Prevents double reviews
    if (regularization.status !== RegularizationStatus.PENDING) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Cannot process. Request is already ${regularization.status}`,
        HttpStatus.CONFLICT,
      );
    }

    const effectiveRemarks =
      ReviewRegularizationDto.resolveRemarks(dto) ??
      (dto as RejectRegularizationDto).reason;

    if (!effectiveRemarks || !effectiveRemarks.trim()) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Rejection reason is required when rejecting a regularization request',
        HttpStatus.BAD_REQUEST,
      );
    }

    const approverEmployee = await this.getEmployeeForUser(actorId);

    // INVARIANT: Self-review prohibited
    if (
      regularization.employeeId.toString() === approverEmployee._id.toString()
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Self-review of regularization requests is strictly prohibited',
        HttpStatus.FORBIDDEN,
      );
    }

    const requestedEmployee = await this.employeeRepository.findById(
      regularization.employeeId,
    );
    if (!requestedEmployee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const isReportingManager =
      requestedEmployee.reportingManagerId &&
      requestedEmployee.reportingManagerId.toString() ===
        approverEmployee._id.toString();

    const hasApprovePermission = await this.authorizationService.hasPermission(
      actorId,
      PermissionKeys.ATTENDANCE_APPROVE,
    );

    if (!isReportingManager && !hasApprovePermission) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'You are not authorized to reject this employee regularization request',
        HttpStatus.FORBIDDEN,
      );
    }

    const session = await this.connection.startSession();
    let updatedReg: AttendanceRegularizationLean | null = null;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        updatedReg = await this.regularizationRepository.updateStatus(
          id,
          RegularizationStatus.REJECTED,
          actorId,
          new Date(),
          effectiveRemarks,
          s,
        );

        if (!updatedReg) {
          throw new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            'Cannot process. Request state changed concurrently or is no longer pending',
            HttpStatus.CONFLICT,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ATTENDANCE_REGULARIZATION_REJECTED,
            targetId: id,
            targetModel: AuditTargetModel.ATTENDANCE_REGULARIZATION,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: {
              attendanceDate: regularization.attendanceDate,
              employeeId: regularization.employeeId,
              reviewRemarks: effectiveRemarks,
            },
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    // =========================================================================
    // TODO: [Notification / Queue Integration] - Regularization Request Rejected
    // =========================================================================
    // Place notification dispatch here (outside DB transaction).
    //
    // Implementation Blueprint for next AI / Developer:
    // 1. Target Recipients:
    //    - Requesting Employee: regularization.employeeId
    // 2. Notification Channels:
    //    - Email: Regularization rejection notice with manager's required reason & resubmission guidance
    //    - Push Notification: FCM alert: "Your regularization request for {date} was rejected: {reason}"
    // 3. Recommended Dispatch Pattern:
    //    await this.eventEmitter.emitAsync('attendance.regularization.rejected', {
    //      eventId: uuidv4(),
    //      eventType: 'ATTENDANCE_REGULARIZATION_REJECTED',
    //      timestamp: new Date().toISOString(),
    //      recipientIds: [regularization.employeeId.toString()],
    //      data: {
    //        regularizationId: id.toString(),
    //        attendanceDate: regularization.attendanceDate,
    //        reviewedBy: approverEmployee._id.toString(),
    //        approverName: `${approverEmployee.firstName} ${approverEmployee.lastName}`,
    //        rejectionReason: effectiveRemarks,
    //      },
    //      metadata: {
    //        notificationTitle: 'Attendance Regularization Rejected',
    //        notificationBody: `Your attendance regularization for ${regularization.attendanceDate} was rejected. Reason: ${effectiveRemarks}`,
    //        webDashboardUrl: `/dashboard/attendance/regularizations/${id}`,
    //      },
    //    });
    // =========================================================================

    return AttendanceRegularizationMapper.toResponse(updatedReg!);
  }

  /**
   * Reports and general attendance listing.
   */
  async listReports(
    query: ListAttendanceQueryDto,
  ): Promise<PaginatedResult<AttendanceResponse>> {
    const filter: Record<string, unknown> = {};

    if (query.employeeId) {
      filter.employeeId = new Types.ObjectId(query.employeeId);
    }

    if (query.status) {
      filter.status = query.status;
    }

    const filterWorkMode =
      query.workMode ||
      (query.attendanceType === 'REGULAR'
        ? WorkMode.OFFICE
        : (query.attendanceType as WorkMode));
    if (filterWorkMode) {
      filter.workMode = filterWorkMode;
    }

    if (typeof query.isLate === 'boolean') {
      filter.isLate = query.isLate;
    }

    if (query.startDate || query.endDate) {
      const dateFilter: Record<string, string> = {};
      if (query.startDate) dateFilter.$gte = query.startDate;
      if (query.endDate) dateFilter.$lte = query.endDate;
      filter.attendanceDate = dateFilter;
    }

    const result = await this.attendanceRepository.findList(
      filter,
      query.page || 1,
      query.limit || 20,
    );

    return {
      data: AttendanceMapper.toResponseList(result.data),
      meta: result.meta,
    };
  }
}

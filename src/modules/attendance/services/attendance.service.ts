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
import { EmployeeRepository } from '../../employees/repositories/employee.repository';
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
  AttendanceType,
  BreakType,
  RegularizationStatus,
} from '../constants/attendance.constant';
import {
  AttendanceCalculationUtil,
  ShiftCalculationParams,
} from '../utils/attendance-calculation.util';
import { CheckInDto } from '../dto/check-in.dto';
import { CheckOutDto } from '../dto/check-out.dto';
import { StartBreakDto } from '../dto/start-break.dto';
import { EndBreakDto } from '../dto/end-break.dto';
import { CreateRegularizationDto } from '../dto/create-regularization.dto';
import { ReviewRegularizationDto } from '../dto/review-regularization.dto';
import { ListAttendanceQueryDto } from '../dto/list-attendance-query.dto';
import { AttendanceCalendarQueryDto } from '../dto/attendance-calendar-query.dto';
import { AttendanceSummaryQueryDto } from '../dto/attendance-summary-query.dto';
import { ListRegularizationQueryDto } from '../dto/list-regularization-query.dto';
import {
  AttendanceMapper,
  AttendanceResponse,
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
    private readonly shiftService: ShiftService,
    private readonly auditLogsService: AuditLogsService,
    private readonly authorizationService: AuthorizationService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Helper to resolve the authenticated user's Employee record.
   */
  private async getEmployeeForUser(userId: Types.ObjectId) {
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
   * Employee check-in workflow.
   */
  async checkIn(
    actorId: Types.ObjectId,
    dto: CheckInDto,
    metadata: ClientMetadata,
  ): Promise<AttendanceResponse> {
    const employee = await this.getEmployeeForUser(actorId);
    const now = new Date();
    const attendanceDate = AttendanceCalculationUtil.getAttendanceDateString(
      now,
      ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
    );

    // 1. Check existing record
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

    // 2. Resolve shift
    const shift = await this.shiftService.resolveShift(
      employee.shiftId,
      dto.shiftId ? new Types.ObjectId(dto.shiftId) : null,
    );

    // 3. Snapshot shift and compute late marking
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
        saved = await this.attendanceRepository.create(
          {
            employeeId: employee._id,
            attendanceDate,
            date: AttendanceCalculationUtil.getNormalizedDate(attendanceDate),
            shiftId: shift._id,
            shiftSnapshot: {
              name: shift.name,
              code: shift.code,
              startTime: shift.startTime,
              endTime: shift.endTime,
              isOvernight: shift.isOvernight,
              gracePeriodMinutes: shift.gracePeriodMinutes,
              minWorkMinutesForFullDay: shift.minWorkMinutesForFullDay,
              minWorkMinutesForHalfDay: shift.minWorkMinutesForHalfDay,
              overtimeThresholdMinutes: shift.overtimeThresholdMinutes,
            },
            checkInTime: now,
            checkOutTime: null,
            status: AttendanceStatus.CHECKED_IN,
            attendanceType: dto.attendanceType || AttendanceType.REGULAR,
            breaks: [],
            totalBreakMinutes: 0,
            totalWorkMinutes: 0,
            isLate: lateCalc.isLate,
            lateMinutes: lateCalc.lateMinutes,
            isEarlyDeparture: false,
            earlyDepartureMinutes: 0,
            overtimeMinutes: 0,
            checkInSource: dto.source || AttendanceSource.WEB,
            checkInIp: metadata.ipAddress || undefined,
            checkInLocation: dto.location,
            checkInNotes: dto.notes?.trim(),
            regularizationId: null,
          },
          s,
        );

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
    const employee = await this.getEmployeeForUser(actorId);
    const now = new Date();
    const attendanceDate = AttendanceCalculationUtil.getAttendanceDateString(
      now,
      ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
    );

    const attendance = await this.attendanceRepository.findByEmployeeAndDate(
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

    // Auto-close break if employee is currently ON_BREAK
    const updatedBrekes = [...(attendance.breaks || [])];
    if (attendance.status === AttendanceStatus.ON_BREAK) {
      const activeBreakIndex = updatedBrekes.findIndex((b) => !b.endTime);
      if (activeBreakIndex !== -1) {
        const activeBreak = updatedBrekes[activeBreakIndex];
        const duration = Math.max(
          0,
          Math.floor((now.getTime() - activeBreak.startTime.getTime()) / 60000),
        );
        updatedBrekes[activeBreakIndex] = {
          ...activeBreak,
          endTime: now,
          durationMinutes: duration,
        };
      }
    }

    const totalBreakMinutes =
      AttendanceCalculationUtil.calculateTotalBreakMinutes(updatedBrekes);

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

    const shiftWindow = AttendanceCalculationUtil.getShiftWindow(
      attendanceDate,
      shiftParams,
    );
    const earlyCalc = AttendanceCalculationUtil.calculateEarlyDeparture(
      now,
      shiftWindow,
    );
    const workCalc = AttendanceCalculationUtil.calculateWorkAndOvertime(
      attendance.checkInTime,
      now,
      totalBreakMinutes,
      shiftParams.overtimeThresholdMinutes,
    );
    const dayStatus = AttendanceCalculationUtil.determineAttendanceStatus(
      workCalc.totalWorkMinutes,
      shiftParams.minWorkMinutesForFullDay,
      shiftParams.minWorkMinutesForHalfDay,
    );

    const session = await this.connection.startSession();
    let updated: AttendanceLean | null = null;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        updated = await this.attendanceRepository.updateById(
          attendance._id,
          {
            checkOutTime: now,
            status: dayStatus,
            breaks: updatedBrekes,
            totalBreakMinutes,
            totalWorkMinutes: workCalc.totalWorkMinutes,
            overtimeMinutes: workCalc.overtimeMinutes,
            isEarlyDeparture: earlyCalc.isEarlyDeparture,
            earlyDepartureMinutes: earlyCalc.earlyDepartureMinutes,
            checkOutSource: dto.source || AttendanceSource.WEB,
            checkOutIp: metadata.ipAddress || undefined,
            checkOutLocation: dto.location,
            checkOutNotes: dto.notes?.trim(),
          },
          s,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ATTENDANCE_CHECK_OUT,
            targetId: attendance._id,
            targetModel: AuditTargetModel.ATTENDANCE,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: {
              attendanceDate,
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
    const employee = await this.getEmployeeForUser(actorId);
    const now = new Date();
    const attendanceDate = AttendanceCalculationUtil.getAttendanceDateString(
      now,
      ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
    );

    const attendance = await this.attendanceRepository.findByEmployeeAndDate(
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

    const breakSession = {
      startTime: now,
      endTime: null,
      durationMinutes: null,
      type: dto.type || BreakType.LUNCH,
      note: dto.note?.trim(),
    };

    const session = await this.connection.startSession();
    let updated: AttendanceLean | null = null;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        updated = await this.attendanceRepository.startBreak(
          attendance._id,
          breakSession,
          s,
        );

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
    const employee = await this.getEmployeeForUser(actorId);
    const now = new Date();
    const attendanceDate = AttendanceCalculationUtil.getAttendanceDateString(
      now,
      ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
    );

    const attendance = await this.attendanceRepository.findByEmployeeAndDate(
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

    const breakDuration = Math.max(
      0,
      Math.floor((now.getTime() - activeBreak.startTime.getTime()) / 60000),
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
        );

        if (dto.note) {
          await this.attendanceRepository.updateById(
            attendance._id,
            { checkInNotes: dto.note.trim() },
            s,
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
    const employee = await this.getEmployeeForUser(actorId);
    const now = new Date();
    const attendanceDate = AttendanceCalculationUtil.getAttendanceDateString(
      now,
      ATTENDANCE_CONSTANTS.DEFAULT_TIMEZONE,
    );

    const attendance = await this.attendanceRepository.findByEmployeeAndDate(
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
    const employee = await this.getEmployeeForUser(actorId);
    const reqIn = new Date(dto.requestedCheckInTime);
    const reqOut = new Date(dto.requestedCheckOutTime);

    if (reqIn.getTime() >= reqOut.getTime()) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'requestedCheckInTime must be earlier than requestedCheckOutTime',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check if pending request already exists
    const existingPending =
      await this.regularizationRepository.findPendingByEmployeeAndDate(
        employee._id,
        dto.attendanceDate,
      );

    if (existingPending) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `A pending regularization request already exists for date ${dto.attendanceDate}`,
        HttpStatus.CONFLICT,
      );
    }

    const attendance = await this.attendanceRepository.findByEmployeeAndDate(
      employee._id,
      dto.attendanceDate,
    );

    const session = await this.connection.startSession();
    let created: AttendanceRegularizationLean;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        created = await this.regularizationRepository.create(
          {
            employeeId: employee._id,
            attendanceId: attendance ? attendance._id : null,
            attendanceDate: dto.attendanceDate,
            requestedCheckInTime: reqIn,
            requestedCheckOutTime: reqOut,
            reason: dto.reason.trim(),
            status: RegularizationStatus.PENDING,
            appliedAt: new Date(),
          },
          s,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ATTENDANCE_REGULARIZATION_REQUESTED,
            targetId: created._id,
            targetModel: AuditTargetModel.ATTENDANCE_REGULARIZATION,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            details: { attendanceDate: dto.attendanceDate, reason: dto.reason },
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

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
   * Enforces self-approval restriction and updates attendance record atomically.
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

    if (regularization.status !== RegularizationStatus.PENDING) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot approve request with status: ${regularization.status}`,
        HttpStatus.BAD_REQUEST,
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

    const session = await this.connection.startSession();
    let updatedReg: AttendanceRegularizationLean | null = null;

    try {
      await session.withTransaction(async (s: ClientSession) => {
        // 1. Update regularization status
        updatedReg = await this.regularizationRepository.updateStatus(
          id,
          RegularizationStatus.APPROVED,
          actorId,
          new Date(),
          dto.reviewRemarks,
          s,
        );

        // 2. Resolve shift and recalculate attendance
        const attendance =
          await this.attendanceRepository.findByEmployeeAndDate(
            regularization.employeeId,
            regularization.attendanceDate,
            s,
          );

        const shift = await this.shiftService.resolveShift(
          requestedEmployee.shiftId,
          attendance?.shiftId,
        );

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
          regularization.attendanceDate,
          shiftParams,
        );
        const lateCalc = AttendanceCalculationUtil.calculateLate(
          regularization.requestedCheckInTime,
          shiftWindow,
        );
        const earlyCalc = AttendanceCalculationUtil.calculateEarlyDeparture(
          regularization.requestedCheckOutTime,
          shiftWindow,
        );

        const totalBreakMinutes = attendance
          ? AttendanceCalculationUtil.calculateTotalBreakMinutes(
              attendance.breaks || [],
            )
          : 0;

        const workCalc = AttendanceCalculationUtil.calculateWorkAndOvertime(
          regularization.requestedCheckInTime,
          regularization.requestedCheckOutTime,
          totalBreakMinutes,
          shiftParams.overtimeThresholdMinutes,
        );

        if (attendance) {
          // Update existing attendance record
          await this.attendanceRepository.updateById(
            attendance._id,
            {
              checkInTime: regularization.requestedCheckInTime,
              checkOutTime: regularization.requestedCheckOutTime,
              status: AttendanceStatus.REGULARIZED,
              totalWorkMinutes: workCalc.totalWorkMinutes,
              overtimeMinutes: workCalc.overtimeMinutes,
              isLate: lateCalc.isLate,
              lateMinutes: lateCalc.lateMinutes,
              isEarlyDeparture: earlyCalc.isEarlyDeparture,
              earlyDepartureMinutes: earlyCalc.earlyDepartureMinutes,
              regularizationId: id,
            },
            s,
          );
        } else {
          // Create new regularized attendance record
          await this.attendanceRepository.create(
            {
              employeeId: regularization.employeeId,
              attendanceDate: regularization.attendanceDate,
              date: AttendanceCalculationUtil.getNormalizedDate(
                regularization.attendanceDate,
              ),
              shiftId: shift._id,
              shiftSnapshot: {
                name: shift.name,
                code: shift.code,
                startTime: shift.startTime,
                endTime: shift.endTime,
                isOvernight: shift.isOvernight,
                gracePeriodMinutes: shift.gracePeriodMinutes,
                minWorkMinutesForFullDay: shift.minWorkMinutesForFullDay,
                minWorkMinutesForHalfDay: shift.minWorkMinutesForHalfDay,
                overtimeThresholdMinutes: shift.overtimeThresholdMinutes,
              },
              checkInTime: regularization.requestedCheckInTime,
              checkOutTime: regularization.requestedCheckOutTime,
              status: AttendanceStatus.REGULARIZED,
              attendanceType: AttendanceType.REGULAR,
              breaks: [],
              totalBreakMinutes: 0,
              totalWorkMinutes: workCalc.totalWorkMinutes,
              isLate: lateCalc.isLate,
              lateMinutes: lateCalc.lateMinutes,
              isEarlyDeparture: earlyCalc.isEarlyDeparture,
              earlyDepartureMinutes: earlyCalc.earlyDepartureMinutes,
              overtimeMinutes: workCalc.overtimeMinutes,
              checkInSource: AttendanceSource.SYSTEM,
              checkOutSource: AttendanceSource.SYSTEM,
              regularizationId: id,
            },
            s,
          );
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
              reviewRemarks: dto.reviewRemarks,
            },
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

    return AttendanceRegularizationMapper.toResponse(updatedReg!);
  }

  /**
   * Reject attendance regularization request.
   */
  async rejectRegularization(
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

    if (regularization.status !== RegularizationStatus.PENDING) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot reject request with status: ${regularization.status}`,
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
          dto.reviewRemarks,
          s,
        );

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
              reviewRemarks: dto.reviewRemarks,
            },
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }

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

    if (query.attendanceType) {
      filter.attendanceType = query.attendanceType;
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

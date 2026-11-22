import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import {
  LeaveTypeRepository,
  LeaveTypeLean,
} from '../repositories/leave-type.repository';
import {
  HolidayRepository,
  HolidayLean,
} from '../repositories/holiday.repository';
import {
  LeaveBalanceRepository,
  LeaveBalanceLean,
} from '../repositories/leave-balance.repository';
import {
  LeaveRequestRepository,
  LeaveRequestLean,
} from '../repositories/leave-request.repository';
import {
  LeaveTransactionRepository,
  LeaveTransactionLean,
} from '../repositories/leave-transaction.repository';
import { CompOffRepository } from '../repositories/comp-off-record.repository';
import {
  EmployeeRepository,
  EmployeeLean,
} from '../../employees/repositories/employee.repository';
import { BranchRepository } from '../../branches/repositories/branch.repository';
import { AttendanceRepository } from '../../attendance/repositories/attendance.repository';
import { ShiftService } from '../../attendance/services/shift.service';
import { WeeklyOffService } from '../../work-schedules/services/weekly-off.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AuthorizationService } from '../../authorization/authorization.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { PermissionKeys } from '../../permissions/constants/permission.constant';
import {
  HalfDaySession,
  LEAVES_CONSTANTS,
  LeaveRequestStatus,
  LeaveTransactionType,
  ReconcileCancellationAction,
} from '../constants/leaves.constant';
import { AttendanceStatus } from '../../attendance/constants/attendance.constant';
import {
  EmploymentStatus,
  ActiveEmploymentStatuses,
} from '../../employees/constants/employee.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { LeaveCalculationUtil } from '../utils/leave-calculation.util';
import { AttendanceCalculationUtil } from '../../attendance/utils/attendance-calculation.util';
import { CreateLeaveTypeDto } from '../dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from '../dto/update-leave-type.dto';
import { ListLeaveTypesQueryDto } from '../dto/list-leave-types-query.dto';
import { CreateHolidayDto } from '../dto/create-holiday.dto';
import { UpdateHolidayDto } from '../dto/update-holiday.dto';
import { ListHolidaysQueryDto } from '../dto/list-holidays-query.dto';
import { AllocateLeaveDto } from '../dto/allocate-leave.dto';
import { AdjustLeaveBalanceDto } from '../dto/adjust-leave-balance.dto';
import { ListLeaveTransactionsQueryDto } from '../dto/list-leave-transactions-query.dto';
import { ApplyLeaveDto } from '../dto/apply-leave.dto';
import { ListLeaveRequestsQueryDto } from '../dto/list-leave-requests-query.dto';
import { ListPendingApprovalsQueryDto } from '../dto/list-pending-approvals-query.dto';
import { ApproveLeaveDto } from '../dto/approve-leave.dto';
import { RejectLeaveDto } from '../dto/reject-leave.dto';
import { CancelLeaveDto } from '../dto/cancel-leave.dto';
import { ReconcileLeaveCancellationDto } from '../dto/reconcile-leave-cancellation.dto';
import { CalendarQueryDto } from '../dto/calendar-query.dto';
import { OrganizationCalendarQueryDto } from '../dto/organization-calendar-query.dto';
import { ProcessCarryForwardDto } from '../dto/process-carry-forward.dto';

export interface ClientMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class LeavesService {
  private readonly logger = new Logger(LeavesService.name);

  constructor(
    private readonly leaveTypeRepo: LeaveTypeRepository,
    private readonly holidayRepo: HolidayRepository,
    private readonly leaveBalanceRepo: LeaveBalanceRepository,
    private readonly leaveRequestRepo: LeaveRequestRepository,
    private readonly leaveTransactionRepo: LeaveTransactionRepository,
    private readonly compOffRepo: CompOffRepository,
    private readonly employeeRepo: EmployeeRepository,
    private readonly branchRepo: BranchRepository,
    private readonly attendanceRepo: AttendanceRepository,
    private readonly shiftService: ShiftService,
    private readonly auditLogsService: AuditLogsService,
    private readonly authorizationService: AuthorizationService,
    @InjectConnection() private readonly connection: Connection,
    @Optional() private readonly weeklyOffService?: WeeklyOffService,
  ) {}

  // ===========================================================================
  // 1. LEAVE TYPES MANAGEMENT
  // ===========================================================================

  async createLeaveType(
    actorId: Types.ObjectId,
    dto: CreateLeaveTypeDto,
    metadata?: ClientMetadata,
  ): Promise<LeaveTypeLean> {
    const existing = await this.leaveTypeRepo.findByCode(dto.code);
    if (existing) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Leave type with code '${dto.code.toUpperCase()}' already exists`,
        HttpStatus.CONFLICT,
      );
    }

    const annualAllocation = dto.annualAllocation ?? 0;
    const isCarryForwardEnabled = dto.isCarryForwardEnabled ?? false;
    const maxCarryForwardDays = isCarryForwardEnabled
      ? (dto.maxCarryForwardDays ?? 0)
      : 0;

    if (isCarryForwardEnabled && maxCarryForwardDays > annualAllocation) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `maxCarryForwardDays (${maxCarryForwardDays}) cannot exceed annualAllocation (${annualAllocation})`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const applicableEmploymentStatuses = dto.applicableEmploymentStatuses
      ? Array.from(new Set(dto.applicableEmploymentStatuses))
      : undefined;

    const session = await this.connection.startSession();
    try {
      let created!: LeaveTypeLean;
      await session.withTransaction(async (s: ClientSession) => {
        const createPayload: Partial<LeaveTypeLean> = {
          ...dto,
          code: dto.code.trim().toUpperCase(),
          isPaid: dto.isPaid ?? true,
          annualAllocation,
          allowHalfDay: dto.allowHalfDay ?? true,
          allowNegativeBalance: dto.allowNegativeBalance ?? false,
          allowDuringNoticePeriod: dto.allowDuringNoticePeriod ?? false,
          deductWeekends: dto.deductWeekends ?? false,
          deductHolidays: dto.deductHolidays ?? false,
          requiresAttachment: dto.requiresAttachment ?? false,
          isCarryForwardEnabled,
          maxCarryForwardDays,
          isActive: dto.isActive ?? true,
          createdBy: actorId,
        };
        if (applicableEmploymentStatuses) {
          createPayload.applicableEmploymentStatuses =
            applicableEmploymentStatuses;
        }

        created = await this.leaveTypeRepo.create(createPayload, s);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.LEAVE_TYPE_CREATED,
            targetId: created._id,
            targetModel: AuditTargetModel.LEAVE_TYPE,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
            details: { code: created.code, name: created.name },
          },
          s,
        );
      });
      return created;
    } finally {
      await session.endSession();
    }
  }

  async listLeaveTypes(
    query: ListLeaveTypesQueryDto,
  ): Promise<PaginatedResult<LeaveTypeLean>> {
    const filter: Record<string, unknown> = {};
    if (typeof query.isActive === 'boolean') filter.isActive = query.isActive;
    if (typeof query.isPaid === 'boolean') filter.isPaid = query.isPaid;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    return this.leaveTypeRepo.findList(filter, page, limit);
  }

  async getLeaveTypeById(id: Types.ObjectId): Promise<LeaveTypeLean> {
    const leaveType = await this.leaveTypeRepo.findById(id);
    if (!leaveType) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Leave type not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return leaveType;
  }

  async updateLeaveType(
    actorId: Types.ObjectId,
    id: Types.ObjectId,
    dto: UpdateLeaveTypeDto,
    metadata?: ClientMetadata,
  ): Promise<LeaveTypeLean> {
    const leaveType = await this.getLeaveTypeById(id);

    if (dto.code && dto.code.trim().toUpperCase() !== leaveType.code) {
      const codeClash = await this.leaveTypeRepo.findByCode(dto.code);
      if (codeClash && codeClash._id.toString() !== id.toString()) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Leave type code '${dto.code.toUpperCase()}' is already taken`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const effectiveCarryForwardEnabled =
      dto.isCarryForwardEnabled !== undefined
        ? dto.isCarryForwardEnabled
        : leaveType.isCarryForwardEnabled;

    const effectiveAnnualAllocation =
      dto.annualAllocation !== undefined
        ? dto.annualAllocation
        : leaveType.annualAllocation;

    const effectiveMaxCarryForwardDays = !effectiveCarryForwardEnabled
      ? 0
      : dto.maxCarryForwardDays !== undefined
        ? dto.maxCarryForwardDays
        : leaveType.maxCarryForwardDays;

    if (
      effectiveCarryForwardEnabled &&
      effectiveMaxCarryForwardDays > effectiveAnnualAllocation
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `maxCarryForwardDays (${effectiveMaxCarryForwardDays}) cannot exceed annualAllocation (${effectiveAnnualAllocation})`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const session = await this.connection.startSession();
    try {
      let updated!: LeaveTypeLean;
      await session.withTransaction(async (s: ClientSession) => {
        const updateData: Partial<LeaveTypeLean> = {
          updatedBy: actorId,
        };

        (Object.keys(dto) as Array<keyof UpdateLeaveTypeDto>).forEach((key) => {
          if (dto[key] !== undefined) {
            (updateData as Record<string, unknown>)[key] = dto[key];
          }
        });

        if (dto.code) {
          updateData.code = dto.code.trim().toUpperCase();
        }

        if (dto.applicableEmploymentStatuses) {
          updateData.applicableEmploymentStatuses = Array.from(
            new Set(dto.applicableEmploymentStatuses),
          );
        }

        if (!effectiveCarryForwardEnabled) {
          // Normalize to 0 when carry-forward is disabled or toggled off
          updateData.maxCarryForwardDays = 0;
        } else if (dto.maxCarryForwardDays !== undefined) {
          updateData.maxCarryForwardDays = dto.maxCarryForwardDays;
        }

        updated = (await this.leaveTypeRepo.updateById(id, updateData, s))!;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.LEAVE_TYPE_UPDATED,
            targetId: id,
            targetModel: AuditTargetModel.LEAVE_TYPE,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
            details: { updatedFields: Object.keys(dto) },
          },
          s,
        );
      });
      return updated;
    } catch (error: unknown) {
      if (this.isMongoDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Leave type with code '${dto.code}' already exists`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async updateLeaveTypeStatus(
    actorId: Types.ObjectId,
    id: Types.ObjectId,
    isActive?: boolean,
    metadata?: ClientMetadata,
  ): Promise<LeaveTypeLean> {
    const current = await this.getLeaveTypeById(id);
    const targetStatus =
      typeof isActive === 'boolean' ? isActive : !current.isActive;

    const session = await this.connection.startSession();
    try {
      let updated!: LeaveTypeLean;
      await session.withTransaction(async (s: ClientSession) => {
        updated = (await this.leaveTypeRepo.updateById(
          id,
          { isActive: targetStatus, updatedBy: actorId },
          s,
        ))!;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.LEAVE_TYPE_STATUS_CHANGED,
            targetId: id,
            targetModel: AuditTargetModel.LEAVE_TYPE,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
            details: {
              previousStatus: current.isActive,
              newStatus: targetStatus,
            },
          },
          s,
        );
      });
      return updated;
    } finally {
      await session.endSession();
    }
  }

  async deleteLeaveType(
    actorId: Types.ObjectId,
    id: Types.ObjectId,
    metadata?: ClientMetadata,
  ): Promise<void> {
    await this.getLeaveTypeById(id);

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async (s: ClientSession) => {
        await this.leaveTypeRepo.softDelete(id, actorId, s);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.LEAVE_TYPE_DELETED,
            targetId: id,
            targetModel: AuditTargetModel.LEAVE_TYPE,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }
  }

  // ===========================================================================
  // 2. HOLIDAYS MANAGEMENT
  // ===========================================================================

  private validateHolidayCalendarDate(date: string): number {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'date must be in YYYY-MM-DD format',
        HttpStatus.BAD_REQUEST,
      );
    }

    const [yearStr, monthStr, dayStr] = date.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (
      calendarDate.getUTCFullYear() !== year ||
      calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Date '${date}' is not a valid calendar date`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return year;
  }

  private async validateBranchForHoliday(
    branchId: string | null | undefined,
  ): Promise<Types.ObjectId | null> {
    if (
      branchId === null ||
      branchId === undefined ||
      branchId === '' ||
      branchId === 'null'
    ) {
      return null;
    }

    if (!Types.ObjectId.isValid(branchId)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid branch ID '${branchId}'`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const branchObjectId = new Types.ObjectId(branchId);
    const branch = await this.branchRepo.findById(branchObjectId);
    if (!branch || branch.deletedAt) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Branch with ID '${branchId}' not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (branch.isActive === false) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot assign holiday to inactive branch '${branch.name}'`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return branchObjectId;
  }

  async createHoliday(
    actorId: Types.ObjectId,
    dto: CreateHolidayDto,
    metadata?: ClientMetadata,
  ): Promise<HolidayLean> {
    const trimmedName = dto.name?.trim();
    if (!trimmedName || trimmedName.length < 2) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Holiday name cannot be empty or whitespace only',
        HttpStatus.BAD_REQUEST,
      );
    }

    const year = this.validateHolidayCalendarDate(dto.date);
    const branchObjectId = await this.validateBranchForHoliday(dto.branchId);

    const existing = await this.holidayRepo.findByDateAndBranch(
      dto.date,
      branchObjectId,
    );
    if (existing) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Holiday already exists for date '${dto.date}' and selected branch scope`,
        HttpStatus.CONFLICT,
      );
    }

    const session = await this.connection.startSession();
    try {
      let created!: HolidayLean;
      await session.withTransaction(async (s: ClientSession) => {
        created = await this.holidayRepo.create(
          {
            ...dto,
            name: trimmedName,
            year,
            branchId: branchObjectId,
            createdBy: actorId,
          },
          s,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.HOLIDAY_CREATED,
            targetId: created._id,
            targetModel: AuditTargetModel.HOLIDAY,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
            details: { name: created.name, date: created.date },
          },
          s,
        );
      });
      return created;
    } catch (error: unknown) {
      if (this.isMongoDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Holiday already exists for date '${dto.date}' and selected branch scope`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async listHolidays(
    query: ListHolidaysQueryDto,
  ): Promise<PaginatedResult<HolidayLean>> {
    const filter: Record<string, unknown> = {};
    if (query.year) filter.year = query.year;
    if (query.branchId) {
      filter.branchId = {
        $in: [null, new Types.ObjectId(query.branchId)],
      };
    }
    if (query.startDate || query.endDate) {
      const dateFilter: Record<string, string> = {};
      if (query.startDate) dateFilter.$gte = query.startDate;
      if (query.endDate) dateFilter.$lte = query.endDate;
      filter.date = dateFilter;
    }
    if (typeof query.isActive === 'boolean') filter.isActive = query.isActive;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.holidayRepo.findList(filter, page, limit);
  }

  async getHolidayById(id: Types.ObjectId): Promise<HolidayLean> {
    const holiday = await this.holidayRepo.findById(id);
    if (!holiday) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Holiday not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return holiday;
  }

  async updateHoliday(
    actorId: Types.ObjectId,
    id: Types.ObjectId,
    dto: UpdateHolidayDto,
    metadata?: ClientMetadata,
  ): Promise<HolidayLean> {
    const holiday = await this.getHolidayById(id);

    let targetDate = holiday.date;
    let year = holiday.year;
    if (dto.date !== undefined) {
      year = this.validateHolidayCalendarDate(dto.date);
      targetDate = dto.date;
    }

    let trimmedName: string | undefined = undefined;
    if (dto.name !== undefined) {
      trimmedName = dto.name.trim();
      if (!trimmedName || trimmedName.length < 2) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Holiday name cannot be empty or whitespace only',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    let targetBranchId: Types.ObjectId | null = holiday.branchId;
    if (dto.branchId !== undefined) {
      targetBranchId = await this.validateBranchForHoliday(dto.branchId);
    }

    if (
      targetDate !== holiday.date ||
      targetBranchId?.toString() !== holiday.branchId?.toString()
    ) {
      const clash = await this.holidayRepo.findByDateAndBranch(
        targetDate,
        targetBranchId,
      );
      if (clash && clash._id.toString() !== id.toString()) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `A holiday already exists for date '${targetDate}' and selected branch scope`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const session = await this.connection.startSession();
    try {
      let updated!: HolidayLean;
      await session.withTransaction(async (s: ClientSession) => {
        const updateData: Partial<HolidayLean> = {
          ...dto,
          ...(trimmedName !== undefined ? { name: trimmedName } : {}),
          branchId: targetBranchId,
          year,
          updatedBy: actorId,
        };

        updated = (await this.holidayRepo.updateById(id, updateData, s))!;

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.HOLIDAY_UPDATED,
            targetId: id,
            targetModel: AuditTargetModel.HOLIDAY,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
          },
          s,
        );
      });
      return updated;
    } catch (error: unknown) {
      if (this.isMongoDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `A holiday already exists for date '${targetDate}' and selected branch scope`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async deleteHoliday(
    actorId: Types.ObjectId,
    id: Types.ObjectId,
    metadata?: ClientMetadata,
  ): Promise<void> {
    await this.getHolidayById(id);

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async (s: ClientSession) => {
        await this.holidayRepo.softDelete(id, actorId, s);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.HOLIDAY_DELETED,
            targetId: id,
            targetModel: AuditTargetModel.HOLIDAY,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }
  }

  // ===========================================================================
  // 3. LEAVE BALANCES & ALLOCATIONS
  // ===========================================================================

  async getMyBalances(
    userId: Types.ObjectId,
    year?: number,
  ): Promise<LeaveBalanceLean[]> {
    const employee = await this.getEmployeeForUser(userId);
    const targetYear = year || new Date().getFullYear();
    return this.leaveBalanceRepo.findAllByEmployeeAndYear(
      employee._id,
      targetYear,
    );
  }

  async getEmployeeBalances(
    actorId: Types.ObjectId,
    employeeId: Types.ObjectId,
    year?: number,
  ): Promise<LeaveBalanceLean[]> {
    const targetEmployee = await this.employeeRepo.findById(employeeId);
    if (!targetEmployee || targetEmployee.deletedAt) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Target employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const hasViewPermission = await this.authorizationService.hasPermission(
      actorId,
      PermissionKeys.LEAVE_BALANCES_VIEW_TEAM,
    );

    let isAuthorized = hasViewPermission;

    if (!isAuthorized) {
      const currentEmployee = await this.employeeRepo.findByUserId(actorId);
      if (currentEmployee) {
        const isSelf = currentEmployee._id.toString() === employeeId.toString();
        const isReportingManager = Boolean(
          targetEmployee.reportingManagerId &&
          targetEmployee.reportingManagerId.toString() ===
            currentEmployee._id.toString(),
        );
        isAuthorized = isSelf || isReportingManager;
      }
    }

    if (!isAuthorized) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Insufficient permission to view employee leave balance',
        HttpStatus.FORBIDDEN,
      );
    }

    const targetYear = year || new Date().getFullYear();
    return this.leaveBalanceRepo.findAllByEmployeeAndYear(
      employeeId,
      targetYear,
    );
  }

  async allocateLeave(
    actorId: Types.ObjectId,
    dto: AllocateLeaveDto,
    metadata?: ClientMetadata,
  ): Promise<LeaveBalanceLean[]> {
    const hasAllocatePermission = await this.authorizationService.hasPermission(
      actorId,
      PermissionKeys.LEAVE_BALANCES_ALLOCATE,
    );
    if (!hasAllocatePermission) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only authorized HR or Admin can allocate leave balances',
        HttpStatus.FORBIDDEN,
      );
    }

    if (dto.days === undefined || dto.days === null || dto.days <= 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Allocation days must be greater than 0',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.carriedForwardDays !== undefined && dto.carriedForwardDays < 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Carried forward days cannot be negative',
        HttpStatus.BAD_REQUEST,
      );
    }

    const employeeObjectId = new Types.ObjectId(dto.employeeId);
    const employee = await this.employeeRepo.findById(employeeObjectId);
    if (!employee || employee.deletedAt) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Target employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const departmentId = employee.departmentId;

    if (!ActiveEmploymentStatuses.includes(employee.employmentStatus)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `Cannot allocate leave balance to employee with status '${employee.employmentStatus}'`,
        HttpStatus.FORBIDDEN,
      );
    }

    const leaveTypeId = new Types.ObjectId(dto.leaveTypeId);
    const leaveType = await this.getLeaveTypeById(leaveTypeId);
    if (!leaveType.isActive) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot allocate balance for inactive leave type '${leaveType.name}'`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      leaveType.applicableEmploymentStatuses?.length &&
      !leaveType.applicableEmploymentStatuses.includes(
        employee.employmentStatus,
      )
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `Employees on '${employee.employmentStatus}' are not eligible for '${leaveType.name}'`,
        HttpStatus.FORBIDDEN,
      );
    }

    if (dto.days !== leaveType.annualAllocation) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Allocation days (${dto.days}) does not match the standard annual entitlement of ${leaveType.annualAllocation} days for leave type '${leaveType.name}'`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const carriedForwardDays = dto.carriedForwardDays ?? 0;

    if (!leaveType.isCarryForwardEnabled && carriedForwardDays > 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot allocate carried forward days because carry-forward is disabled for leave type '${leaveType.name}'`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      leaveType.isCarryForwardEnabled &&
      leaveType.maxCarryForwardDays > 0 &&
      carriedForwardDays > leaveType.maxCarryForwardDays
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Carried forward days (${carriedForwardDays}) exceeds the maximum allowed limit of ${leaveType.maxCarryForwardDays} days for leave type '${leaveType.name}'`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const existingBalance = await this.leaveBalanceRepo.findByEmployeeTypeYear(
      employee._id,
      leaveTypeId,
      dto.year,
    );
    if (existingBalance) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Leave balance already allocated for employee for leave type '${leaveType.name}' in year ${dto.year}. Use balance adjustment API to modify existing balance.`,
        HttpStatus.CONFLICT,
      );
    }

    const session = await this.connection.startSession();
    try {
      let balance!: LeaveBalanceLean;
      await session.withTransaction(async (s: ClientSession) => {
        const existingInTx = await this.leaveBalanceRepo.findByEmployeeTypeYear(
          employee._id,
          leaveTypeId,
          dto.year,
          s,
        );
        if (existingInTx) {
          throw new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            `Leave balance already allocated for employee for leave type '${leaveType.name}' in year ${dto.year}. Use balance adjustment API to modify existing balance.`,
            HttpStatus.CONFLICT,
          );
        }

        balance = await this.leaveBalanceRepo.upsertAllocation(
          employee._id,
          leaveTypeId,
          dto.year,
          dto.days,
          dto.carriedForwardDays || 0,
          actorId,
          s,
        );

        await this.leaveTransactionRepo.create(
          {
            employeeId: employee._id,
            leaveTypeId,
            year: dto.year,
            transactionType: LeaveTransactionType.ALLOCATION,
            days: dto.days,
            previousAvailable: balance.availableBalance - dto.days,
            newAvailable: balance.availableBalance,
            referenceId: null,
            referenceType: 'Allocation',
            remarks: dto.remarks || 'Annual leave allocation grant',
            actorId,
          },
          s,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.LEAVE_BALANCE_ALLOCATED,
            targetId: balance._id,
            targetModel: AuditTargetModel.LEAVE_BALANCE,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
            details: {
              employeeId: employee._id,
              departmentId,
              leaveTypeId,
              year: dto.year,
              allocatedDays: dto.days,
              carriedForwardDays: dto.carriedForwardDays || 0,
            },
          },
          s,
        );
      });
      return [balance];
    } catch (error: unknown) {
      if (this.isMongoDuplicateKeyError(error)) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Leave balance already allocated for employee for leave type '${leaveType.name}' in year ${dto.year}. Use balance adjustment API to modify existing balance.`,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async adjustBalance(
    actorId: Types.ObjectId,
    dto: AdjustLeaveBalanceDto,
    metadata?: ClientMetadata,
  ): Promise<LeaveBalanceLean> {
    const hasAdjustPermission = await this.authorizationService.hasPermission(
      actorId,
      PermissionKeys.LEAVE_BALANCES_ADJUST,
    );
    if (!hasAdjustPermission) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only authorized HR or Admin can adjust leave balances',
        HttpStatus.FORBIDDEN,
      );
    }

    if (
      !dto.year ||
      !Number.isInteger(dto.year) ||
      dto.year < 2000 ||
      dto.year > 2100
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Year must be a valid integer between 2000 and 2100',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      !dto.reason ||
      typeof dto.reason !== 'string' ||
      dto.reason.trim().length < 5
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Adjustment reason is required and must contain at least 5 characters',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.days <= 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Adjustment days must be greater than 0',
        HttpStatus.BAD_REQUEST,
      );
    }

    const decimalPlaces = (dto.days.toString().split('.')[1] || '').length;
    if (decimalPlaces > 2) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Adjustment days cannot exceed 2 decimal places of precision',
        HttpStatus.BAD_REQUEST,
      );
    }

    const targetEmpId = new Types.ObjectId(dto.employeeId);
    const employee = await this.employeeRepo.findById(targetEmpId);
    if (!employee || employee.deletedAt) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!ActiveEmploymentStatuses.includes(employee.employmentStatus)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `Cannot adjust leave balance for employee with status '${employee.employmentStatus}'`,
        HttpStatus.FORBIDDEN,
      );
    }

    const targetLeaveTypeId = new Types.ObjectId(dto.leaveTypeId);
    const leaveType = await this.getLeaveTypeById(targetLeaveTypeId);

    if (!leaveType.isActive) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot adjust balance for inactive leave type '${leaveType.name}'`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      leaveType.applicableEmploymentStatuses?.length &&
      !leaveType.applicableEmploymentStatuses.includes(
        employee.employmentStatus,
      )
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `Employees on '${employee.employmentStatus}' are not eligible for '${leaveType.name}'`,
        HttpStatus.FORBIDDEN,
      );
    }

    const session = await this.connection.startSession();
    try {
      let updatedBalance!: LeaveBalanceLean;
      await session.withTransaction(async (s: ClientSession) => {
        const existing = await this.leaveBalanceRepo.findByEmployeeTypeYear(
          targetEmpId,
          targetLeaveTypeId,
          dto.year,
          s,
        );
        if (!existing) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            `Leave balance not found for employee for leave type '${leaveType.name}' in year ${dto.year}`,
            HttpStatus.NOT_FOUND,
          );
        }

        const previousAvailable = existing.availableBalance;

        const updated = await this.leaveBalanceRepo.manualAdjust(
          targetEmpId,
          targetLeaveTypeId,
          dto.year,
          dto.adjustmentType,
          dto.days,
          actorId,
          leaveType.allowNegativeBalance,
          s,
        );

        if (!updated) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Insufficient available balance to perform manual debit adjustment',
            HttpStatus.BAD_REQUEST,
          );
        }
        updatedBalance = updated;

        const transType =
          dto.adjustmentType === 'CREDIT'
            ? LeaveTransactionType.MANUAL_CREDIT
            : LeaveTransactionType.MANUAL_DEBIT;

        await this.leaveTransactionRepo.create(
          {
            employeeId: targetEmpId,
            leaveTypeId: targetLeaveTypeId,
            year: dto.year,
            transactionType: transType,
            days: dto.adjustmentType === 'CREDIT' ? dto.days : -dto.days,
            previousAvailable,
            newAvailable: updatedBalance.availableBalance,
            referenceId: null,
            referenceType: 'ManualAdjustment',
            remarks: dto.reason.trim(),
            actorId,
          },
          s,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.LEAVE_BALANCE_ADJUSTED,
            targetId: updatedBalance._id,
            targetModel: AuditTargetModel.LEAVE_BALANCE,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
            details: {
              adjustmentType: dto.adjustmentType,
              days: dto.days,
              reason: dto.reason.trim(),
            },
          },
          s,
        );
      });
      return updatedBalance;
    } finally {
      await session.endSession();
    }
  }

  async getTransactions(
    actorId: Types.ObjectId,
    employeeId: Types.ObjectId,
    query: ListLeaveTransactionsQueryDto,
  ): Promise<PaginatedResult<LeaveTransactionLean>> {
    const targetEmployee = await this.employeeRepo.findById(employeeId);
    if (!targetEmployee || targetEmployee.deletedAt) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Target employee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const hasViewPermission =
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVE_BALANCES_VIEW_TEAM_TRANSACTIONS,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVE_BALANCES_VIEW_TEAM,
      ));

    let isAuthorized = hasViewPermission;

    if (!isAuthorized) {
      const currentEmployee = await this.employeeRepo.findByUserId(actorId);
      if (currentEmployee) {
        const isSelf = currentEmployee._id.toString() === employeeId.toString();
        const isReportingManager = Boolean(
          targetEmployee.reportingManagerId &&
          targetEmployee.reportingManagerId.toString() ===
            currentEmployee._id.toString(),
        );
        isAuthorized = isSelf || isReportingManager;
      }
    }

    if (!isAuthorized) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Insufficient permission to view employee leave transactions',
        HttpStatus.FORBIDDEN,
      );
    }

    const filter: Record<string, unknown> = { employeeId };
    if (query.leaveTypeId)
      filter.leaveTypeId = new Types.ObjectId(query.leaveTypeId);
    if (query.year) filter.year = query.year;
    if (query.transactionType) filter.transactionType = query.transactionType;

    return this.leaveTransactionRepo.findList(
      filter,
      query.page || 1,
      query.limit || 20,
    );
  }

  async getMyTransactions(
    userId: Types.ObjectId,
    query: ListLeaveTransactionsQueryDto,
  ): Promise<PaginatedResult<LeaveTransactionLean>> {
    const employee = await this.getEmployeeForUser(userId);
    return this.getTransactions(userId, employee._id, query);
  }

  // ===========================================================================
  // 4. LEAVE REQUESTS WORKFLOW (APPLY, APPROVE, REJECT, CANCEL)
  // ===========================================================================

  async applyLeave(
    userId: Types.ObjectId,
    dto: ApplyLeaveDto,
    metadata?: ClientMetadata,
  ): Promise<LeaveRequestLean> {
    // 0. Half-day and session consistency validation
    if (dto.isHalfDay && !dto.halfDaySession) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Half-day session is required for half-day leave',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!dto.isHalfDay && dto.halfDaySession) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'halfDaySession must not be provided when isHalfDay is false',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      dto.isHalfDay &&
      dto.halfDaySession &&
      !Object.values(HalfDaySession).includes(dto.halfDaySession)
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'halfDaySession must be either FIRST_HALF or SECOND_HALF',
        HttpStatus.BAD_REQUEST,
      );
    }

    const employee = await this.getEmployeeForUser(userId);

    // 1. Employment status guard
    if (
      employee.employmentStatus === EmploymentStatus.TERMINATED ||
      employee.employmentStatus === EmploymentStatus.RESIGNED
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `Employees with status '${employee.employmentStatus}' cannot apply for leave`,
        HttpStatus.FORBIDDEN,
      );
    }

    // 2. Joining date guard
    const joiningDateStr = employee.dateOfJoining.toISOString().slice(0, 10);
    if (dto.startDate < joiningDateStr) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot apply for leave prior to date of joining (${joiningDateStr})`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. Leave type eligibility
    const leaveType = await this.getLeaveTypeById(
      new Types.ObjectId(dto.leaveTypeId),
    );
    if (!leaveType.isActive) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Leave type '${leaveType.name}' is currently inactive`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Notice period restriction
    if (
      employee.employmentStatus === EmploymentStatus.NOTICE_PERIOD &&
      !leaveType.allowDuringNoticePeriod
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `'${leaveType.name}' cannot be taken during notice period per company policy`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Employment status eligibility on leave type
    if (
      employee.employmentStatus !== EmploymentStatus.NOTICE_PERIOD &&
      leaveType.applicableEmploymentStatuses &&
      !leaveType.applicableEmploymentStatuses.includes(
        employee.employmentStatus,
      )
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `Employees on '${employee.employmentStatus}' are not eligible for '${leaveType.name}'`,
        HttpStatus.FORBIDDEN,
      );
    }

    // Attachment requirement guard
    if (
      leaveType.requiresAttachment &&
      (!dto.attachmentUrl || !dto.attachmentUrl.trim())
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Supporting attachment is required for '${leaveType.name}'`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 4. Resolve applicable holidays for employee's branch
    const applicableHolidays = await this.holidayRepo.findApplicableHolidays(
      dto.startDate,
      dto.endDate,
      employee.branchId,
    );
    const holidayDates = new Set(applicableHolidays.map((h) => h.date));

    // Resolve dynamic weekly-off dates from the centralized organizational policy
    const weeklyOffDates = this.weeklyOffService
      ? await this.weeklyOffService.getWeeklyOffDatesForRange(
          dto.startDate,
          dto.endDate,
          employee.branchId,
        )
      : undefined;

    // 5. Centralized Leave Duration & Year Breakdown Calculation
    const calcResult = LeaveCalculationUtil.calculateLeaveDuration(
      dto.startDate,
      dto.endDate,
      dto.isHalfDay || false,
      {
        deductWeekends: leaveType.deductWeekends,
        deductHolidays: leaveType.deductHolidays,
        allowHalfDay: leaveType.allowHalfDay,
        maxConsecutiveDays: leaveType.maxConsecutiveDays,
      },
      holidayDates,
      weeklyOffDates ?? [0],
    );

    // 6. Atomic Transaction & Concurrency Mutex (Part 4)
    const session = await this.connection.startSession();
    try {
      let createdRequest!: LeaveRequestLean;
      await session.withTransaction(async (s: ClientSession) => {
        // Mutex: Exclusively lock the employee aggregate root to serialize concurrent submissions
        await this.employeeRepo.updateById(
          employee._id,
          { updatedAt: new Date() },
          s,
        );

        // Transactional Overlap Guard: Evaluated within transaction session to eliminate race conditions
        const overlapping = await this.leaveRequestRepo.findOverlappingRequests(
          employee._id,
          dto.startDate,
          dto.endDate,
          undefined,
          s,
        );
        if (overlapping.length > 0) {
          throw new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            `You already have a pending or approved leave request overlapping dates ${dto.startDate} to ${dto.endDate}`,
            HttpStatus.CONFLICT,
          );
        }

        // Generate LeaveRequest ObjectId upfront so all ledger reservations reference it
        const requestId = new Types.ObjectId();

        // Reserve balance for each year in the crossover breakdown atomically (User Decision #3)
        for (const split of calcResult.yearBreakdown) {
          const reserved = await this.leaveBalanceRepo.reserveBalance(
            employee._id,
            leaveType._id,
            split.year,
            split.days,
            leaveType.allowNegativeBalance,
            userId,
            s,
          );

          if (!reserved) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              `Insufficient leave balance for year ${split.year}. Requested: ${split.days} days`,
              HttpStatus.BAD_REQUEST,
            );
          }

          // Double-entry ledger audit
          await this.leaveTransactionRepo.create(
            {
              employeeId: employee._id,
              leaveTypeId: leaveType._id,
              year: split.year,
              transactionType: LeaveTransactionType.RESERVATION,
              days: -split.days,
              previousAvailable: reserved.availableBalance + split.days,
              newAvailable: reserved.availableBalance,
              referenceId: requestId,
              referenceType: 'LeaveRequest',
              remarks: `Leave application reservation for ${dto.startDate} to ${dto.endDate}`,
              actorId: userId,
            },
            s,
          );
        }

        // Create LeaveRequest
        createdRequest = await this.leaveRequestRepo.create(
          {
            _id: requestId,
            employeeId: employee._id,
            leaveTypeId: leaveType._id,
            leaveTypeSnapshot: {
              name: leaveType.name,
              code: leaveType.code,
              isPaid: leaveType.isPaid,
              allowHalfDay: leaveType.allowHalfDay,
              deductWeekends: leaveType.deductWeekends,
              deductHolidays: leaveType.deductHolidays,
            },
            startDate: dto.startDate,
            endDate: dto.endDate,
            totalDays: calcResult.totalDays,
            isHalfDay: Boolean(dto.isHalfDay),
            halfDaySession: dto.isHalfDay ? dto.halfDaySession! : null,
            yearBreakdown: calcResult.yearBreakdown,
            excludedDates: Array.from(
              new Set([
                ...calcResult.excludedWeekendDates,
                ...calcResult.excludedHolidayDates,
              ]),
            ),
            reason: dto.reason,
            attachmentUrl: dto.attachmentUrl,
            reportingManagerId: employee.reportingManagerId,
            status: LeaveRequestStatus.PENDING,
            approvalTimeline: [],
            appliedAt: new Date(),
            createdBy: userId,
          },
          s,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId: userId,
            action: AuditAction.LEAVE_REQUEST_CREATED,
            targetId: createdRequest._id,
            targetModel: AuditTargetModel.LEAVE_REQUEST,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
            details: {
              totalDays: calcResult.totalDays,
              startDate: dto.startDate,
              endDate: dto.endDate,
              yearBreakdown: calcResult.yearBreakdown,
            },
          },
          s,
        );
      });

      return createdRequest;
    } finally {
      await session.endSession();
    }
  }

  async getMyRequests(
    userId: Types.ObjectId,
    query: ListLeaveRequestsQueryDto,
  ): Promise<PaginatedResult<LeaveRequestLean>> {
    if (query.startDate && query.endDate && query.startDate > query.endDate) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'startDate must not be later than endDate',
        HttpStatus.BAD_REQUEST,
      );
    }

    const employee = await this.getEmployeeForUser(userId);
    const filter: Record<string, unknown> = { employeeId: employee._id };

    if (query.status) filter.status = query.status;
    if (query.leaveTypeId)
      filter.leaveTypeId = new Types.ObjectId(query.leaveTypeId);
    if (query.year) {
      filter['yearBreakdown.year'] = query.year;
    }
    if (query.startDate) {
      filter.endDate = { $gte: query.startDate };
    }
    if (query.endDate) {
      filter.startDate = { $lte: query.endDate };
    }

    return this.leaveRequestRepo.findList(
      filter,
      query.page || 1,
      query.limit || 20,
      { createdAt: -1 },
    );
  }

  async listRequests(
    actorId: Types.ObjectId,
    query: ListLeaveRequestsQueryDto,
  ): Promise<PaginatedResult<LeaveRequestLean>> {
    if (query.startDate && query.endDate && query.startDate > query.endDate) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'startDate must not be later than endDate',
        HttpStatus.BAD_REQUEST,
      );
    }

    const currentEmployee = await this.employeeRepo.findByUserId(actorId);
    const hasViewPermission =
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVE_REQUESTS_VIEW_TEAM,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVE_REQUESTS_VIEW,
      ));

    const filter: Record<string, unknown> = {};

    if (query.employeeId) {
      const targetEmpId = new Types.ObjectId(query.employeeId);
      const isSelf = currentEmployee?._id.toString() === targetEmpId.toString();

      const targetEmployee = await this.employeeRepo.findById(targetEmpId);
      const isReportingManager =
        currentEmployee &&
        targetEmployee?.reportingManagerId &&
        targetEmployee.reportingManagerId.toString() ===
          currentEmployee._id.toString();

      if (!isSelf && !isReportingManager && !hasViewPermission) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Insufficient permissions to view leave requests for this employee',
          HttpStatus.FORBIDDEN,
        );
      }

      filter.employeeId = targetEmpId;
    } else {
      if (hasViewPermission) {
        // HR can view all requests
      } else if (currentEmployee) {
        // Manager can see direct reports + self
        const directReports = await this.employeeRepo.findByReportingManager(
          currentEmployee._id,
        );
        const allowedIds = [
          currentEmployee._id,
          ...directReports.map((r: EmployeeLean) => r._id),
        ];
        filter.employeeId = { $in: allowedIds };
      } else {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Insufficient permissions to view leave requests',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    if (query.status) filter.status = query.status;
    if (query.leaveTypeId)
      filter.leaveTypeId = new Types.ObjectId(query.leaveTypeId);
    if (query.year) {
      filter['yearBreakdown.year'] = query.year;
    }
    if (query.startDate) {
      filter.endDate = { $gte: query.startDate };
    }
    if (query.endDate) {
      filter.startDate = { $lte: query.endDate };
    }

    return this.leaveRequestRepo.findList(
      filter,
      query.page || 1,
      query.limit || 20,
      { createdAt: -1 },
    );
  }

  async getRequestById(
    actorId: Types.ObjectId,
    requestId: Types.ObjectId,
  ): Promise<LeaveRequestLean> {
    const request = await this.leaveRequestRepo.findById(requestId);
    if (!request) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Leave request not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const targetEmployee = await this.employeeRepo.findById(request.employeeId);

    const hasViewPermission =
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVE_REQUESTS_VIEW,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVE_REQUESTS_VIEW_TEAM,
      ));

    let isAuthorized = hasViewPermission;

    if (!isAuthorized) {
      const currentEmployee = await this.employeeRepo.findByUserId(actorId);
      if (currentEmployee) {
        const isSelf =
          currentEmployee._id.toString() === request.employeeId.toString();
        const isReportingManager = Boolean(
          targetEmployee?.reportingManagerId &&
          targetEmployee.reportingManagerId.toString() ===
            currentEmployee._id.toString(),
        );
        isAuthorized = isSelf || isReportingManager;
      }
    }

    if (!isAuthorized) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Insufficient permission to view this leave request',
        HttpStatus.FORBIDDEN,
      );
    }

    return request;
  }

  async getPendingApprovals(
    userId: Types.ObjectId,
    query: ListPendingApprovalsQueryDto,
  ): Promise<PaginatedResult<LeaveRequestLean>> {
    if (query.startDate && query.endDate && query.startDate > query.endDate) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'startDate must not be later than endDate',
        HttpStatus.BAD_REQUEST,
      );
    }

    const currentEmployee = await this.getEmployeeForUser(userId);
    const filter: Record<string, unknown> = {};

    if (query.employeeId) {
      filter.employeeId = new Types.ObjectId(query.employeeId);
    }
    if (query.leaveTypeId) {
      filter.leaveTypeId = new Types.ObjectId(query.leaveTypeId);
    }
    if (query.year) {
      filter['yearBreakdown.year'] = query.year;
    }
    if (query.startDate) {
      filter.endDate = { $gte: query.startDate };
    }
    if (query.endDate) {
      filter.startDate = { $lte: query.endDate };
    }

    return this.leaveRequestRepo.findPendingApprovalsByManager(
      currentEmployee._id,
      query.page || 1,
      query.limit || 20,
      filter,
    );
  }

  async approveLeave(
    actorId: Types.ObjectId,
    requestId: Types.ObjectId,
    dto: ApproveLeaveDto,
    metadata?: ClientMetadata,
  ): Promise<LeaveRequestLean> {
    const request = await this.leaveRequestRepo.findById(requestId);
    if (!request) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Leave request not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const currentEmployee = await this.employeeRepo.findByUserId(actorId);

    // Guard: Self-approval prohibition
    if (
      currentEmployee &&
      request.employeeId.toString() === currentEmployee._id.toString()
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Employees cannot approve their own leave requests',
        HttpStatus.FORBIDDEN,
      );
    }

    const targetEmployee = await this.employeeRepo.findById(request.employeeId);
    if (!targetEmployee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee profile not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Guard: Reporting Manager or HR Override
    const isReportingManager = Boolean(
      currentEmployee &&
      targetEmployee.reportingManagerId &&
      targetEmployee.reportingManagerId.toString() ===
        currentEmployee._id.toString(),
    );

    const hasApprovePermission = await this.authorizationService.hasPermission(
      actorId,
      PermissionKeys.LEAVE_REQUESTS_APPROVE,
    );

    if (!isReportingManager && !hasApprovePermission) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only the assigned reporting manager or authorized HR can approve leave requests',
        HttpStatus.FORBIDDEN,
      );
    }

    const session = await this.connection.startSession();
    try {
      let updatedRequest!: LeaveRequestLean;
      await session.withTransaction(async (s: ClientSession) => {
        // Atomic status transition guard (must be PENDING)
        const updated = await this.leaveRequestRepo.updateStatus(
          requestId,
          LeaveRequestStatus.PENDING,
          LeaveRequestStatus.APPROVED,
          {
            approverId: actorId,
            fromStatus: LeaveRequestStatus.PENDING,
            toStatus: LeaveRequestStatus.APPROVED,
            remarks: dto.remarks,
            timestamp: new Date(),
            isOverride: !isReportingManager,
          },
          {},
          s,
        );

        if (!updated) {
          throw new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            'Cannot approve leave request: request is not in PENDING status',
            HttpStatus.CONFLICT,
          );
        }
        updatedRequest = updated;

        // Debit reserved days into usedDays across each year
        const yearSplits =
          request.yearBreakdown && request.yearBreakdown.length > 0
            ? request.yearBreakdown
            : [
                {
                  year: Number(request.startDate.slice(0, 4)),
                  days: request.totalDays,
                },
              ];

        for (const split of yearSplits) {
          const debited = await this.leaveBalanceRepo.debitApprovedBalance(
            request.employeeId,
            request.leaveTypeId,
            split.year,
            split.days,
            actorId,
            s,
          );

          if (!debited) {
            throw new AppError(
              ErrorCode.INTERNAL_SERVER_ERROR,
              `Failed to debit approved leave balance for year ${split.year}`,
              HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }

          await this.leaveTransactionRepo.create(
            {
              employeeId: request.employeeId,
              leaveTypeId: request.leaveTypeId,
              year: split.year,
              transactionType: LeaveTransactionType.APPROVAL_DEBIT,
              days: -split.days,
              previousAvailable: debited.availableBalance,
              newAvailable: debited.availableBalance,
              referenceId: request._id,
              referenceType: 'LeaveRequest',
              remarks: `Leave approved by ${isReportingManager ? 'Reporting Manager' : 'HR'}`,
              actorId,
            },
            s,
          );
        }

        // Part 12: Comp-Off Redemption Tracking
        if (request.leaveTypeSnapshot?.code === 'COMP_OFF') {
          const todayStr = AttendanceCalculationUtil.getAttendanceDateString(
            new Date(),
          );
          const availableCompOffs =
            await this.compOffRepo.findAvailableCompOffs(
              request.employeeId,
              todayStr,
              s,
            );
          const toRedeem = availableCompOffs.slice(
            0,
            Math.ceil(request.totalDays),
          );
          for (const co of toRedeem) {
            await this.compOffRepo.redeemCompOff(co._id, request._id, s);
          }
        }

        // Attendance Module Integration: Sync approved leave days to attendance collection
        const shift = await this.shiftService.resolveShift(
          targetEmployee.shiftId,
          null,
          { employeeId: targetEmployee._id },
        );

        const dateList = LeaveCalculationUtil.enumerateDateStrings(
          request.startDate,
          request.endDate,
        );

        for (const dStr of dateList) {
          // If the date was explicitly excluded during leave calculation (weekly-off or holiday), do not mark ON_LEAVE
          if (request.excludedDates && request.excludedDates.includes(dStr)) {
            continue;
          }

          // Fallback for legacy requests without excludedDates
          if (!request.excludedDates) {
            const isWeeklyOff = this.weeklyOffService
              ? await this.weeklyOffService.isWeeklyOff(
                  dStr,
                  targetEmployee.branchId,
                )
              : false;

            if (isWeeklyOff && !request.leaveTypeSnapshot.deductWeekends) {
              continue;
            }

            const isHoliday =
              (
                await this.holidayRepo.findApplicableHolidays(
                  dStr,
                  dStr,
                  targetEmployee.branchId,
                )
              ).length > 0;

            if (isHoliday && !request.leaveTypeSnapshot.deductHolidays) {
              continue;
            }
          }

          const attStatus = request.isHalfDay
            ? AttendanceStatus.HALF_DAY
            : AttendanceStatus.ON_LEAVE;

          await this.attendanceRepo.syncLeaveAttendance(
            targetEmployee._id,
            dStr,
            attStatus,
            shift._id,
            {
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
            request._id,
            s,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.LEAVE_REQUEST_APPROVED,
            targetId: request._id,
            targetModel: AuditTargetModel.LEAVE_REQUEST,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
            details: {
              approvedBy: actorId,
              isOverride: !isReportingManager,
              remarks: dto.remarks,
            },
          },
          s,
        );
      });
      return updatedRequest;
    } finally {
      await session.endSession();
    }
  }

  async rejectLeave(
    actorId: Types.ObjectId,
    requestId: Types.ObjectId,
    dto: RejectLeaveDto,
    metadata?: ClientMetadata,
  ): Promise<LeaveRequestLean> {
    const request = await this.leaveRequestRepo.findById(requestId);
    if (!request) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Leave request not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const currentEmployee = await this.employeeRepo.findByUserId(actorId);

    // Guard: Self-rejection prohibition
    if (
      currentEmployee &&
      request.employeeId.toString() === currentEmployee._id.toString()
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Employees cannot reject their own leave requests',
        HttpStatus.FORBIDDEN,
      );
    }

    const targetEmployee = await this.employeeRepo.findById(request.employeeId);
    if (!targetEmployee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee profile not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const isReportingManager = Boolean(
      currentEmployee &&
      targetEmployee.reportingManagerId &&
      targetEmployee.reportingManagerId.toString() ===
        currentEmployee._id.toString(),
    );

    const hasRejectPermission =
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVE_REQUESTS_REJECT,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVE_REQUESTS_APPROVE,
      ));

    if (!isReportingManager && !hasRejectPermission) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only the assigned reporting manager or authorized HR can reject leave requests',
        HttpStatus.FORBIDDEN,
      );
    }

    const session = await this.connection.startSession();
    try {
      let updatedRequest!: LeaveRequestLean;
      await session.withTransaction(async (s: ClientSession) => {
        const updated = await this.leaveRequestRepo.updateStatus(
          requestId,
          LeaveRequestStatus.PENDING,
          LeaveRequestStatus.REJECTED,
          {
            approverId: actorId,
            fromStatus: LeaveRequestStatus.PENDING,
            toStatus: LeaveRequestStatus.REJECTED,
            remarks: dto.reason,
            timestamp: new Date(),
            isOverride: !isReportingManager,
          },
          { rejectionReason: dto.reason },
          s,
        );

        if (!updated) {
          throw new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            'Cannot reject leave request: request is not in PENDING status',
            HttpStatus.CONFLICT,
          );
        }
        updatedRequest = updated;

        // Release reservations back to available balance
        const yearSplits =
          request.yearBreakdown && request.yearBreakdown.length > 0
            ? request.yearBreakdown
            : [
                {
                  year: Number(request.startDate.slice(0, 4)),
                  days: request.totalDays,
                },
              ];

        for (const split of yearSplits) {
          const released = await this.leaveBalanceRepo.releaseReservation(
            request.employeeId,
            request.leaveTypeId,
            split.year,
            split.days,
            actorId,
            s,
          );

          if (released) {
            await this.leaveTransactionRepo.create(
              {
                employeeId: request.employeeId,
                leaveTypeId: request.leaveTypeId,
                year: split.year,
                transactionType: LeaveTransactionType.RESERVATION_RELEASE,
                days: split.days,
                previousAvailable: released.availableBalance - split.days,
                newAvailable: released.availableBalance,
                referenceId: request._id,
                referenceType: 'LeaveRequest',
                remarks: `Reservation released due to rejection: ${dto.reason}`,
                actorId,
              },
              s,
            );
          }
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.LEAVE_REQUEST_REJECTED,
            targetId: request._id,
            targetModel: AuditTargetModel.LEAVE_REQUEST,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
            details: { reason: dto.reason },
          },
          s,
        );
      });
      return updatedRequest;
    } finally {
      await session.endSession();
    }
  }

  async cancelLeave(
    userId: Types.ObjectId,
    requestId: Types.ObjectId,
    dto: CancelLeaveDto,
    metadata?: ClientMetadata,
  ): Promise<LeaveRequestLean> {
    const request = await this.leaveRequestRepo.findById(requestId);
    if (!request) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Leave request not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const currentEmployee = await this.getEmployeeForUser(userId);
    const isOwner =
      request.employeeId.toString() === currentEmployee._id.toString();

    const hasEditPermission =
      (await this.authorizationService.hasPermission(
        userId,
        PermissionKeys.LEAVE_REQUESTS_EDIT,
      )) ||
      (await this.authorizationService.hasPermission(
        userId,
        PermissionKeys.LEAVES_EDIT,
      ));

    if (!isOwner && !hasEditPermission) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'You can only cancel your own leave requests unless you possess HR edit permissions',
        HttpStatus.FORBIDDEN,
      );
    }

    const todayStr = AttendanceCalculationUtil.getAttendanceDateString(
      new Date(),
    );

    // Case 1: Pending request cancellation
    if (request.status === LeaveRequestStatus.PENDING) {
      const session = await this.connection.startSession();
      try {
        let cancelled!: LeaveRequestLean;
        await session.withTransaction(async (s: ClientSession) => {
          cancelled = (await this.leaveRequestRepo.updateStatus(
            requestId,
            LeaveRequestStatus.PENDING,
            LeaveRequestStatus.CANCELLED,
            {
              approverId: userId,
              fromStatus: LeaveRequestStatus.PENDING,
              toStatus: LeaveRequestStatus.CANCELLED,
              remarks: dto.reason,
              timestamp: new Date(),
              isOverride: !isOwner,
            },
            { cancellationReason: dto.reason },
            s,
          ))!;

          const pendingYearSplits =
            request.yearBreakdown && request.yearBreakdown.length > 0
              ? request.yearBreakdown
              : [
                  {
                    year: Number(request.startDate.slice(0, 4)),
                    days: request.totalDays,
                  },
                ];

          for (const split of pendingYearSplits) {
            const released = await this.leaveBalanceRepo.releaseReservation(
              request.employeeId,
              request.leaveTypeId,
              split.year,
              split.days,
              userId,
              s,
            );
            if (released) {
              await this.leaveTransactionRepo.create(
                {
                  employeeId: request.employeeId,
                  leaveTypeId: request.leaveTypeId,
                  year: split.year,
                  transactionType: LeaveTransactionType.RESERVATION_RELEASE,
                  days: split.days,
                  previousAvailable: released.availableBalance - split.days,
                  newAvailable: released.availableBalance,
                  referenceId: request._id,
                  referenceType: 'LeaveRequest',
                  remarks: `Reservation released due to cancellation: ${dto.reason}`,
                  actorId: userId,
                },
                s,
              );
            }
          }

          await this.auditLogsService.createAuditLog(
            {
              actorId: userId,
              action: AuditAction.LEAVE_REQUEST_CANCELLED,
              targetId: request._id,
              targetModel: AuditTargetModel.LEAVE_REQUEST,
              ipAddress: metadata?.ipAddress ?? null,
              userAgent: metadata?.userAgent ?? null,
              details: {
                reason: dto.reason,
                statusAtCancellation: LeaveRequestStatus.PENDING,
              },
            },
            s,
          );
        });
        return cancelled;
      } finally {
        await session.endSession();
      }
    }

    // Case 2: Future Approved request cancellation (startDate > todayStr)
    if (
      request.status === LeaveRequestStatus.APPROVED &&
      request.startDate > todayStr
    ) {
      const session = await this.connection.startSession();
      try {
        let cancelled!: LeaveRequestLean;
        await session.withTransaction(async (s: ClientSession) => {
          cancelled = (await this.leaveRequestRepo.updateStatus(
            requestId,
            LeaveRequestStatus.APPROVED,
            LeaveRequestStatus.CANCELLED,
            {
              approverId: userId,
              fromStatus: LeaveRequestStatus.APPROVED,
              toStatus: LeaveRequestStatus.CANCELLED,
              remarks: dto.reason,
              timestamp: new Date(),
              isOverride: !isOwner,
            },
            { cancellationReason: dto.reason },
            s,
          ))!;

          // Restore balance across years
          const approvedYearSplits =
            request.yearBreakdown && request.yearBreakdown.length > 0
              ? request.yearBreakdown
              : [
                  {
                    year: Number(request.startDate.slice(0, 4)),
                    days: request.totalDays,
                  },
                ];

          for (const split of approvedYearSplits) {
            const restored = await this.leaveBalanceRepo.creditCancelledBalance(
              request.employeeId,
              request.leaveTypeId,
              split.year,
              split.days,
              userId,
              s,
            );

            if (restored) {
              await this.leaveTransactionRepo.create(
                {
                  employeeId: request.employeeId,
                  leaveTypeId: request.leaveTypeId,
                  year: split.year,
                  transactionType: LeaveTransactionType.CANCELLATION_CREDIT,
                  days: split.days,
                  previousAvailable: restored.availableBalance - split.days,
                  newAvailable: restored.availableBalance,
                  referenceId: request._id,
                  referenceType: 'LeaveRequest',
                  remarks: `Approved leave cancelled; balance restored: ${dto.reason}`,
                  actorId: userId,
                },
                s,
              );
            }
          }

          // Clear future attendance records
          await this.attendanceRepo.removeFutureLeaveAttendance(
            request._id,
            todayStr,
            s,
          );

          if (request.leaveTypeSnapshot?.code === 'COMP_OFF') {
            await this.compOffRepo.revertCompOffRedemption(request._id, s);
          }

          await this.auditLogsService.createAuditLog(
            {
              actorId: userId,
              action: AuditAction.LEAVE_REQUEST_CANCELLED,
              targetId: request._id,
              targetModel: AuditTargetModel.LEAVE_REQUEST,
              ipAddress: metadata?.ipAddress ?? null,
              userAgent: metadata?.userAgent ?? null,
              details: {
                reason: dto.reason,
                statusAtCancellation: LeaveRequestStatus.APPROVED,
              },
            },
            s,
          );
        });
        return cancelled;
      } finally {
        await session.endSession();
      }
    }

    // Case 3: Past / In-progress Approved request cancellation (User Decision #4)
    // Do NOT silently overwrite past attendance to ABSENT. Place in CANCELLATION_REQUESTED
    if (
      request.status === LeaveRequestStatus.APPROVED &&
      request.startDate <= todayStr
    ) {
      const session = await this.connection.startSession();
      try {
        let requested!: LeaveRequestLean;
        await session.withTransaction(async (s: ClientSession) => {
          requested = (await this.leaveRequestRepo.updateStatus(
            requestId,
            LeaveRequestStatus.APPROVED,
            LeaveRequestStatus.CANCELLATION_REQUESTED,
            {
              approverId: userId,
              fromStatus: LeaveRequestStatus.APPROVED,
              toStatus: LeaveRequestStatus.CANCELLATION_REQUESTED,
              remarks: dto.reason,
              timestamp: new Date(),
              isOverride: !isOwner,
            },
            {
              cancellationReason: dto.reason,
              reconciliationNotes:
                'Awaiting HR attendance reconciliation for past approved leave cancellation.',
            },
            s,
          ))!;

          await this.auditLogsService.createAuditLog(
            {
              actorId: userId,
              action: AuditAction.LEAVE_CANCELLATION_REQUESTED,
              targetId: request._id,
              targetModel: AuditTargetModel.LEAVE_REQUEST,
              ipAddress: metadata?.ipAddress ?? null,
              userAgent: metadata?.userAgent ?? null,
              details: {
                reason: dto.reason,
                notes: 'Requires HR authorized reconciliation',
              },
            },
            s,
          );
        });
        return requested;
      } finally {
        await session.endSession();
      }
    }

    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Cannot cancel leave request in status '${request.status}'`,
      HttpStatus.BAD_REQUEST,
    );
  }

  // ===========================================================================
  // 5. HR LEAVE CANCELLATION RECONCILIATION WORKFLOW (TIER 3 POLICY)
  // ===========================================================================

  async reconcileLeaveCancellation(
    actorId: Types.ObjectId,
    requestId: Types.ObjectId,
    dto: ReconcileLeaveCancellationDto,
    metadata?: ClientMetadata,
  ): Promise<LeaveRequestLean> {
    const request = await this.leaveRequestRepo.findById(requestId);
    if (!request) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Leave request not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Guard 1: Must be in CANCELLATION_REQUESTED status
    if (request.status !== LeaveRequestStatus.CANCELLATION_REQUESTED) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot reconcile leave request in status '${request.status}': request must be in 'CANCELLATION_REQUESTED' status`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Guard 2: Target employee verification
    const targetEmployee = await this.employeeRepo.findById(request.employeeId);
    if (!targetEmployee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Employee profile not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Guard 3: Self-reconciliation prohibition
    const currentEmployee = await this.employeeRepo.findByUserId(actorId);
    if (
      currentEmployee &&
      request.employeeId.toString() === currentEmployee._id.toString()
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Employees cannot reconcile their own leave cancellation requests',
        HttpStatus.FORBIDDEN,
      );
    }

    // Guard 4: Authorized HR / Admin permission check
    const hasReconcilePermission =
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVE_REQUESTS_APPROVE,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVE_REQUESTS_EDIT,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVES_EDIT,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVE_BALANCES_ADJUST,
      ));

    if (!hasReconcilePermission) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only authorized HR/admin users can reconcile leave cancellations',
        HttpStatus.FORBIDDEN,
      );
    }

    const todayStr = AttendanceCalculationUtil.getAttendanceDateString(
      new Date(),
    );
    const startUtc = new Date(`${request.startDate}T00:00:00.000Z`).getTime();
    const todayUtc = new Date(`${todayStr}T00:00:00.000Z`).getTime();
    const elapsedDays = Math.floor(
      (todayUtc - startUtc) / (1000 * 60 * 60 * 24),
    );

    // Guard 5: Server-side payroll safety check (do not trust client flag)
    if (dto.isPayrollProcessed === true) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot reconcile leave cancellation: payroll has already been processed for this leave period. Since the Payroll module is not available to automate retro-pay adjustments, historical leave reconciliation is locked to prevent payroll discrepancies.`,
        HttpStatus.CONFLICT,
      );
    }

    if (elapsedDays > LEAVES_CONSTANTS.PAYROLL_LOCKOUT_MAX_PAST_DAYS) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot reconcile leave cancellation: leave start date (${request.startDate}) is ${elapsedDays} days in the past, exceeding the server-side payroll safety window of ${LEAVES_CONSTANTS.PAYROLL_LOCKOUT_MAX_PAST_DAYS} days. Since the Payroll module is not available to automate retro-pay adjustments, historical leave reconciliation is locked to prevent payroll discrepancies.`,
        HttpStatus.CONFLICT,
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACTION: REJECT CANCELLATION (Reverts status to APPROVED, retains deduction)
    // ─────────────────────────────────────────────────────────────────────────
    if (dto.action === ReconcileCancellationAction.REJECT) {
      const session = await this.connection.startSession();
      try {
        let rejected!: LeaveRequestLean;
        await session.withTransaction(async (s: ClientSession) => {
          const updated = await this.leaveRequestRepo.updateStatus(
            requestId,
            LeaveRequestStatus.CANCELLATION_REQUESTED,
            LeaveRequestStatus.APPROVED,
            {
              approverId: actorId,
              fromStatus: LeaveRequestStatus.CANCELLATION_REQUESTED,
              toStatus: LeaveRequestStatus.APPROVED,
              remarks: dto.remarks,
              timestamp: new Date(),
              isOverride: true,
            },
            {
              cancellationReviewedBy: actorId,
              cancellationReviewedAt: new Date(),
              reconciliationNotes: `Cancellation rejected by HR: ${dto.remarks}. Attendance verification: ${dto.actualAttendanceDetails}. Original leave deduction maintained.`,
            },
            s,
          );

          if (!updated) {
            throw new AppError(
              ErrorCode.RESOURCE_ALREADY_EXISTS,
              'Cannot reconcile leave request: request is not in CANCELLATION_REQUESTED status',
              HttpStatus.CONFLICT,
            );
          }
          rejected = updated;

          await this.auditLogsService.createAuditLog(
            {
              actorId,
              action: AuditAction.LEAVE_CANCELLATION_RECONCILED,
              targetId: request._id,
              targetModel: AuditTargetModel.LEAVE_REQUEST,
              ipAddress: metadata?.ipAddress ?? null,
              userAgent: metadata?.userAgent ?? null,
              details: {
                action: ReconcileCancellationAction.REJECT,
                remarks: dto.remarks,
                actualAttendanceDetails: dto.actualAttendanceDetails,
                fromStatus: LeaveRequestStatus.CANCELLATION_REQUESTED,
                toStatus: LeaveRequestStatus.APPROVED,
                refundedDays: 0,
              },
            },
            s,
          );
        });
        return rejected;
      } finally {
        await session.endSession();
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACTION: APPROVE CANCELLATION (Refund eligible days, transition to CANCELLED)
    // ─────────────────────────────────────────────────────────────────────────
    const originalSplits =
      request.yearBreakdown && request.yearBreakdown.length > 0
        ? request.yearBreakdown
        : [
            {
              year: Number(request.startDate.slice(0, 4)),
              days: request.totalDays,
            },
          ];

    // Determine refundable splits & verified attendance updates
    let splitsToRefund: Array<{ year: number; days: number }> = [];
    const verifiedAttendanceUpdates: Array<{
      attendanceId: Types.ObjectId;
      status: AttendanceStatus;
    }> = [];

    if (dto.datesWorked && dto.datesWorked.length > 0) {
      // 1. Resolve excluded dates (with legacy request fallback)
      let excluded = new Set(request.excludedDates || []);

      if (!request.excludedDates || request.excludedDates.length === 0) {
        const dynamicallyExcluded = new Set<string>();
        for (const d of dto.datesWorked) {
          let isWeeklyOff = false;
          if (this.weeklyOffService) {
            isWeeklyOff = await this.weeklyOffService.isWeeklyOff(
              d,
              targetEmployee.branchId,
            );
          } else {
            const dayOfWeek = new Date(`${d}T00:00:00.000Z`).getUTCDay();
            isWeeklyOff = dayOfWeek === 0;
          }
          if (isWeeklyOff && !request.leaveTypeSnapshot.deductWeekends) {
            dynamicallyExcluded.add(d);
          }

          const holidays = await this.holidayRepo.findApplicableHolidays(
            d,
            d,
            targetEmployee.branchId,
          );
          if (
            holidays.length > 0 &&
            !request.leaveTypeSnapshot.deductHolidays
          ) {
            dynamicallyExcluded.add(d);
          }
        }
        excluded = dynamicallyExcluded;
      }

      // 2. Validate date formats, ranges, holidays/weekends, and duplicates
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      const seenDates = new Set<string>();

      for (const d of dto.datesWorked) {
        if (!dateRegex.test(d)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Invalid date format '${d}' in datesWorked; expected YYYY-MM-DD`,
            HttpStatus.BAD_REQUEST,
          );
        }
        if (d < request.startDate || d > request.endDate) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Date '${d}' in datesWorked is outside the leave range (${request.startDate} to ${request.endDate})`,
            HttpStatus.BAD_REQUEST,
          );
        }
        if (excluded.has(d)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Date '${d}' in datesWorked was excluded as a holiday or weekly-off in the original request and cannot be refunded`,
            HttpStatus.BAD_REQUEST,
          );
        }
        if (seenDates.has(d)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Duplicate date '${d}' in datesWorked`,
            HttpStatus.BAD_REQUEST,
          );
        }
        seenDates.add(d);
      }

      // 3. Verify each date against authoritative attendance records and calculate status
      const yearMap = new Map<number, number>();
      for (const d of seenDates) {
        const att = await this.attendanceRepo.findByEmployeeAndDate(
          request.employeeId,
          d,
        );
        if (!att) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `No attendance record found for employee on date ${d}`,
            HttpStatus.BAD_REQUEST,
          );
        }
        if (
          att.leaveRequestId &&
          att.leaveRequestId.toString() !== request._id.toString()
        ) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Attendance record on date ${d} is linked to a different leave request`,
            HttpStatus.BAD_REQUEST,
          );
        }

        let calculatedStatus: AttendanceStatus;
        let dayCount: number;

        if (att.totalWorkMinutes && att.totalWorkMinutes > 0) {
          calculatedStatus =
            AttendanceCalculationUtil.determineAttendanceStatus(
              att.totalWorkMinutes,
              att.shiftSnapshot || {
                minWorkMinutesForFullDay: 480,
                minWorkMinutesForHalfDay: 240,
              },
            );
          dayCount =
            calculatedStatus === AttendanceStatus.HALF_DAY
              ? 0.5
              : request.isHalfDay
                ? 0.5
                : 1;
        } else {
          calculatedStatus = request.isHalfDay
            ? AttendanceStatus.HALF_DAY
            : AttendanceStatus.PRESENT;
          dayCount = request.isHalfDay ? 0.5 : 1;
        }

        verifiedAttendanceUpdates.push({
          attendanceId: att._id,
          status: calculatedStatus,
        });

        const y = Number(d.slice(0, 4));
        yearMap.set(y, (yearMap.get(y) || 0) + dayCount);
      }

      const totalDaysFromDates = Array.from(yearMap.values()).reduce(
        (sum, v) => sum + v,
        0,
      );

      // 4. Input conflict detection
      if (
        typeof dto.refundedDays === 'number' &&
        Math.abs(dto.refundedDays - totalDaysFromDates) > 0.001
      ) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Mismatched refund inputs: refundedDays (${dto.refundedDays}) does not match the total days calculated from datesWorked (${totalDaysFromDates})`,
          HttpStatus.BAD_REQUEST,
        );
      }

      if (dto.yearBreakdown && dto.yearBreakdown.length > 0) {
        for (const split of dto.yearBreakdown) {
          const expected = yearMap.get(split.year) || 0;
          if (Math.abs(split.days - expected) > 0.001) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              `Mismatched refund inputs: yearBreakdown for year ${split.year} (${split.days} days) does not match datesWorked (${expected} days)`,
              HttpStatus.BAD_REQUEST,
            );
          }
        }
      }

      splitsToRefund = Array.from(yearMap.entries()).map(([year, days]) => ({
        year,
        days,
      }));
    } else {
      // datesWorked is NOT provided
      if (dto.refundedDays === 0) {
        if (dto.yearBreakdown && dto.yearBreakdown.some((s) => s.days > 0)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Mismatched refund inputs: refundedDays is 0 but yearBreakdown contains positive days',
            HttpStatus.BAD_REQUEST,
          );
        }
        splitsToRefund = originalSplits.map((s) => ({
          year: s.year,
          days: 0,
        }));
      } else if (dto.refundedDays === request.totalDays) {
        // Full refund without datesWorked (e.g. administrative full cancellation)
        if (dto.yearBreakdown && dto.yearBreakdown.length > 0) {
          const sum = dto.yearBreakdown.reduce((acc, y) => acc + y.days, 0);
          if (Math.abs(sum - dto.refundedDays) > 0.001) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              `Mismatched refund inputs: sum of yearBreakdown days (${sum}) does not match refundedDays (${dto.refundedDays})`,
              HttpStatus.BAD_REQUEST,
            );
          }
          splitsToRefund = dto.yearBreakdown.map((s) => ({
            year: s.year,
            days: s.days,
          }));
        } else {
          splitsToRefund = originalSplits;
        }
      } else if (
        typeof dto.refundedDays === 'number' &&
        dto.refundedDays < request.totalDays
      ) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Specific datesWorked must be provided for partial leave cancellation refunds to verify attendance records',
          HttpStatus.BAD_REQUEST,
        );
      } else if (dto.yearBreakdown && dto.yearBreakdown.length > 0) {
        const sum = dto.yearBreakdown.reduce((acc, y) => acc + y.days, 0);
        if (sum < request.totalDays) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Specific datesWorked must be provided for partial leave cancellation refunds to verify attendance records',
            HttpStatus.BAD_REQUEST,
          );
        }
        splitsToRefund = dto.yearBreakdown.map((s) => ({
          year: s.year,
          days: s.days,
        }));
      } else {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Refundable days specification is required when approving cancellation. Provide 'refundedDays', 'yearBreakdown', or 'datesWorked'.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Validate splits against original duration limits
    const originalMap = new Map<number, number>(
      originalSplits.map((s) => [s.year, s.days]),
    );

    let totalRefundedDays = 0;
    for (const split of splitsToRefund) {
      if (split.days < 0) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Refunded days cannot be negative for year ${split.year}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      const originalMax = originalMap.get(split.year);
      if (originalMax === undefined) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Year ${split.year} was not part of the original leave request breakdown`,
          HttpStatus.BAD_REQUEST,
        );
      }
      if (split.days > originalMax) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Refunded days (${split.days}) for year ${split.year} cannot exceed original leave days (${originalMax})`,
          HttpStatus.BAD_REQUEST,
        );
      }
      totalRefundedDays += split.days;
    }

    if (totalRefundedDays > request.totalDays) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Total refunded days (${totalRefundedDays}) cannot exceed original leave total days (${request.totalDays})`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const session = await this.connection.startSession();
    try {
      let approvedCancelled!: LeaveRequestLean;
      await session.withTransaction(async (s: ClientSession) => {
        // Atomic status transition guard (must be CANCELLATION_REQUESTED)
        const updated = await this.leaveRequestRepo.updateStatus(
          requestId,
          LeaveRequestStatus.CANCELLATION_REQUESTED,
          LeaveRequestStatus.CANCELLED,
          {
            approverId: actorId,
            fromStatus: LeaveRequestStatus.CANCELLATION_REQUESTED,
            toStatus: LeaveRequestStatus.CANCELLED,
            remarks: dto.remarks,
            timestamp: new Date(),
            isOverride: true,
          },
          {
            cancellationReviewedBy: actorId,
            cancellationReviewedAt: new Date(),
            reconciliationNotes: `Cancellation approved by HR: ${dto.remarks}. Attendance verification: ${dto.actualAttendanceDetails}. Refunded: ${totalRefundedDays} of ${request.totalDays} days.`,
          },
          s,
        );

        if (!updated) {
          throw new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            'Cannot reconcile leave request: request is not in CANCELLATION_REQUESTED status',
            HttpStatus.CONFLICT,
          );
        }
        approvedCancelled = updated;

        // Restore verified balance per calendar year
        for (const split of splitsToRefund) {
          if (split.days > 0) {
            const restored = await this.leaveBalanceRepo.creditCancelledBalance(
              request.employeeId,
              request.leaveTypeId,
              split.year,
              split.days,
              actorId,
              s,
            );

            if (!restored) {
              throw new AppError(
                ErrorCode.VALIDATION_ERROR,
                `Cannot refund ${split.days} days for year ${split.year}: insufficient used balance to credit`,
                HttpStatus.BAD_REQUEST,
              );
            }

            // Append-only immutable ledger entry
            await this.leaveTransactionRepo.create(
              {
                employeeId: request.employeeId,
                leaveTypeId: request.leaveTypeId,
                year: split.year,
                transactionType: LeaveTransactionType.CANCELLATION_CREDIT,
                days: split.days,
                previousAvailable: restored.availableBalance - split.days,
                newAvailable: restored.availableBalance,
                referenceId: request._id,
                referenceType: 'LeaveRequest',
                remarks: `Reconciled cancellation credit: ${dto.remarks}`,
                actorId,
              },
              s,
            );
          }
        }

        // Revert comp-off if applicable
        if (
          request.leaveTypeSnapshot?.code === 'COMP_OFF' &&
          totalRefundedDays > 0
        ) {
          await this.compOffRepo.revertCompOffRedemption(request._id, s);
        }

        // Attendance synchronization
        // If leave had future dates, clear them
        if (request.endDate > todayStr) {
          await this.attendanceRepo.removeFutureLeaveAttendance(
            request._id,
            todayStr,
            s,
          );
        }

        // For verified worked dates, detach leaveRequestId and update status using calculated attendance status
        for (const update of verifiedAttendanceUpdates) {
          await this.attendanceRepo.updateById(
            update.attendanceId,
            {
              leaveRequestId: null,
              status: update.status,
            },
            s,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.LEAVE_CANCELLATION_RECONCILED,
            targetId: request._id,
            targetModel: AuditTargetModel.LEAVE_REQUEST,
            ipAddress: metadata?.ipAddress ?? null,
            userAgent: metadata?.userAgent ?? null,
            details: {
              action: ReconcileCancellationAction.APPROVE,
              remarks: dto.remarks,
              actualAttendanceDetails: dto.actualAttendanceDetails,
              refundedDays: totalRefundedDays,
              yearBreakdown: splitsToRefund,
              fromStatus: LeaveRequestStatus.CANCELLATION_REQUESTED,
              toStatus: LeaveRequestStatus.CANCELLED,
            },
          },
          s,
        );
      });
      return approvedCancelled;
    } finally {
      await session.endSession();
    }
  }

  // ===========================================================================
  // 6. YEAR-END CARRY-FORWARD PROCESSING (PART 10)
  // ===========================================================================

  async processYearEndCarryForward(
    actorId: Types.ObjectId,
    dto: ProcessCarryForwardDto,
    metadata?: ClientMetadata,
  ): Promise<{
    fromYear: number;
    toYear: number;
    processedEmployees: number;
    totalCarriedForwardDays: number;
  }> {
    if (
      !dto.fromYear ||
      !Number.isInteger(dto.fromYear) ||
      dto.fromYear < 2000 ||
      dto.fromYear > 2100
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'fromYear must be an integer between 2000 and 2100',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      !dto.toYear ||
      !Number.isInteger(dto.toYear) ||
      dto.toYear < 2000 ||
      dto.toYear > 2100
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'toYear must be an integer between 2000 and 2100',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.fromYear >= dto.toYear) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'fromYear must be strictly less than toYear',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.toYear !== dto.fromYear + 1) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'toYear must be consecutive to fromYear (exactly fromYear + 1)',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 1. Resolve leave types with carry forward enabled
    let leaveTypes: LeaveTypeLean[];
    if (dto.leaveTypeId) {
      const single = await this.getLeaveTypeById(
        new Types.ObjectId(dto.leaveTypeId),
      );
      if (!single.isActive) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Cannot carry forward for inactive leave type '${single.name}'`,
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!single.isCarryForwardEnabled) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Leave type '${single.name}' does not have carry forward enabled`,
          HttpStatus.BAD_REQUEST,
        );
      }
      leaveTypes = [single];
    } else {
      const allTypes = await this.leaveTypeRepo.findList(
        { isCarryForwardEnabled: true, isActive: true },
        1,
        100,
      );
      leaveTypes = allTypes.data;
    }

    if (leaveTypes.length === 0) {
      return {
        fromYear: dto.fromYear,
        toYear: dto.toYear,
        processedEmployees: 0,
        totalCarriedForwardDays: 0,
      };
    }

    // 2. Resolve eligible employees
    const eligibleCarryForwardStatuses: EmploymentStatus[] = [
      EmploymentStatus.ACTIVE,
      EmploymentStatus.PROBATION,
    ];

    let employees: EmployeeLean[];
    if (dto.employeeId) {
      const emp = await this.employeeRepo.findById(
        new Types.ObjectId(dto.employeeId),
      );
      if (!emp || emp.deletedAt) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Employee not found',
          HttpStatus.NOT_FOUND,
        );
      }
      if (!eligibleCarryForwardStatuses.includes(emp.employmentStatus)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Employee is not eligible for leave carry forward',
          HttpStatus.BAD_REQUEST,
        );
      }
      employees = [emp];
    } else {
      const empList = await this.employeeRepo.findList({
        page: 1,
        limit: 1000,
      });
      employees = empList.data.filter((e) =>
        eligibleCarryForwardStatuses.includes(e.employmentStatus),
      );
    }

    // 3. Check single-target duplicate up front if specific employee and leave type requested
    if (dto.employeeId && dto.leaveTypeId) {
      const existingTx =
        await this.leaveTransactionRepo.findCarryForwardTransaction(
          new Types.ObjectId(dto.employeeId),
          new Types.ObjectId(dto.leaveTypeId),
          dto.toYear,
        );
      if (existingTx) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Carry forward for leave type '${leaveTypes[0].name}' has already been processed for year ${dto.toYear}`,
          HttpStatus.CONFLICT,
        );
      }
    }

    let processedCount = 0;
    let totalCarriedDays = 0;

    for (const emp of employees) {
      for (const lt of leaveTypes) {
        // Skip if this employee + leaveType has already received carry forward for toYear
        const existingTx =
          await this.leaveTransactionRepo.findCarryForwardTransaction(
            emp._id,
            lt._id,
            dto.toYear,
          );
        if (existingTx) {
          continue;
        }

        const fromBalance = await this.leaveBalanceRepo.findByEmployeeTypeYear(
          emp._id,
          lt._id,
          dto.fromYear,
        );

        if (!fromBalance || fromBalance.availableBalance <= 0) {
          continue;
        }

        const remaining = Math.max(0, fromBalance.availableBalance);
        const cappedCarryForward = Math.min(remaining, lt.maxCarryForwardDays);

        if (cappedCarryForward <= 0) {
          continue;
        }

        const session = await this.connection.startSession();
        try {
          let carriedInTx = 0;
          await session.withTransaction(async (s: ClientSession) => {
            // Concurrency guard inside transaction to prevent race conditions
            const inTxExisting =
              await this.leaveTransactionRepo.findCarryForwardTransaction(
                emp._id,
                lt._id,
                dto.toYear,
                s,
              );
            if (inTxExisting) {
              return;
            }

            const updatedToBalance =
              await this.leaveBalanceRepo.upsertAllocation(
                emp._id,
                lt._id,
                dto.toYear,
                0,
                cappedCarryForward,
                actorId,
                s,
              );

            await this.leaveTransactionRepo.create(
              {
                employeeId: emp._id,
                leaveTypeId: lt._id,
                year: dto.toYear,
                transactionType: LeaveTransactionType.CARRY_FORWARD,
                days: cappedCarryForward,
                previousAvailable:
                  updatedToBalance.availableBalance - cappedCarryForward,
                newAvailable: updatedToBalance.availableBalance,
                referenceId: null,
                referenceType: 'YearEndCarryForward',
                remarks: `Year-end carry forward of ${cappedCarryForward} days from year ${dto.fromYear}`,
                actorId,
              },
              s,
            );

            await this.auditLogsService.createAuditLog(
              {
                actorId,
                action: AuditAction.LEAVE_BALANCE_ADJUSTED,
                targetId: updatedToBalance._id,
                targetModel: AuditTargetModel.LEAVE_BALANCE,
                ipAddress: metadata?.ipAddress ?? null,
                userAgent: metadata?.userAgent ?? null,
                details: {
                  fromYear: dto.fromYear,
                  toYear: dto.toYear,
                  employeeId: emp._id,
                  leaveTypeId: lt._id,
                  carriedForwardDays: cappedCarryForward,
                },
              },
              s,
            );

            carriedInTx = cappedCarryForward;
          });

          totalCarriedDays += carriedInTx;
        } finally {
          await session.endSession();
        }
      }
      processedCount++;
    }

    return {
      fromYear: dto.fromYear,
      toYear: dto.toYear,
      processedEmployees: processedCount,
      totalCarriedForwardDays: totalCarriedDays,
    };
  }

  // ===========================================================================
  // 7. CALENDAR & SCHEDULE VISUALIZATION (PART 13)
  // ===========================================================================

  async getMyCalendar(
    userId: Types.ObjectId,
    query: CalendarQueryDto,
  ): Promise<{
    employeeId: Types.ObjectId;
    startDate: string;
    endDate: string;
    leaves: LeaveRequestLean[];
    holidays: HolidayLean[];
  }> {
    if (query.startDate > query.endDate) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'startDate cannot be after endDate',
        HttpStatus.BAD_REQUEST,
      );
    }
    const employee = await this.getEmployeeForUser(userId);

    const [leaves, holidays] = await Promise.all([
      this.leaveRequestRepo.findOverlappingRequests(
        employee._id,
        query.startDate,
        query.endDate,
      ),
      this.holidayRepo.findApplicableHolidays(
        query.startDate,
        query.endDate,
        employee.branchId,
      ),
    ]);

    return {
      employeeId: employee._id,
      startDate: query.startDate,
      endDate: query.endDate,
      leaves,
      holidays,
    };
  }

  async getTeamCalendar(
    userId: Types.ObjectId,
    query: CalendarQueryDto,
  ): Promise<{
    managerId: Types.ObjectId;
    startDate: string;
    endDate: string;
    teamMembers: Array<{
      _id: Types.ObjectId;
      employeeCode: string;
      firstName: string;
      lastName: string;
    }>;
    leaves: LeaveRequestLean[];
    holidays: HolidayLean[];
  }> {
    if (query.startDate > query.endDate) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'startDate cannot be after endDate',
        HttpStatus.BAD_REQUEST,
      );
    }
    const manager = await this.getEmployeeForUser(userId);

    const directReports = await this.employeeRepo.findByReportingManager(
      manager._id,
    );
    const teamMemberIds = directReports.map((emp) => emp._id);

    const [leavesResult, holidays] = await Promise.all([
      teamMemberIds.length > 0
        ? this.leaveRequestRepo.findList(
            {
              employeeId: { $in: teamMemberIds },
              startDate: { $lte: query.endDate },
              endDate: { $gte: query.startDate },
              status: {
                $in: [
                  LeaveRequestStatus.PENDING,
                  LeaveRequestStatus.APPROVED,
                  LeaveRequestStatus.CANCELLATION_REQUESTED,
                ],
              },
            },
            1,
            500,
          )
        : Promise.resolve({ data: [] }),
      this.holidayRepo.findApplicableHolidays(
        query.startDate,
        query.endDate,
        manager.branchId,
      ),
    ]);

    return {
      managerId: manager._id,
      startDate: query.startDate,
      endDate: query.endDate,
      teamMembers: directReports.map((e) => ({
        _id: e._id,
        employeeCode: e.employeeCode,
        firstName: e.firstName,
        lastName: e.lastName,
      })),
      leaves: leavesResult.data,
      holidays,
    };
  }

  async getOrganizationCalendar(query: OrganizationCalendarQueryDto): Promise<{
    startDate: string;
    endDate: string;
    leaves: LeaveRequestLean[];
    holidays: HolidayLean[];
  }> {
    if (query.startDate > query.endDate) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'startDate cannot be after endDate',
        HttpStatus.BAD_REQUEST,
      );
    }

    const employeesResult = await this.employeeRepo.findList({
      page: 1,
      limit: 1000,
      branchId: query.branchId,
      departmentId: query.departmentId,
    });
    const matchedEmployeeIds = employeesResult.data.map((e) => e._id);

    const [leavesResult, holidays] = await Promise.all([
      matchedEmployeeIds.length > 0
        ? this.leaveRequestRepo.findList(
            {
              employeeId: { $in: matchedEmployeeIds },
              startDate: { $lte: query.endDate },
              endDate: { $gte: query.startDate },
              status: {
                $in: [
                  LeaveRequestStatus.PENDING,
                  LeaveRequestStatus.APPROVED,
                  LeaveRequestStatus.CANCELLATION_REQUESTED,
                ],
              },
            },
            1,
            1000,
          )
        : Promise.resolve({ data: [] }),
      this.holidayRepo.findApplicableHolidays(
        query.startDate,
        query.endDate,
        query.branchId ? new Types.ObjectId(query.branchId) : undefined,
      ),
    ]);

    return {
      startDate: query.startDate,
      endDate: query.endDate,
      leaves: leavesResult.data,
      holidays,
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private async getEmployeeForUser(
    userId: Types.ObjectId,
  ): Promise<EmployeeLean> {
    const employee = await this.employeeRepo.findByUserId(userId);
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
   * Helper to detect MongoDB unique compound index duplicate key error (code 11000).
   */
  private isMongoDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const err = error as {
      code?: number;
      message?: string;
      name?: string;
      cause?: unknown;
    };
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
      const cause = err.cause as { code?: number; message?: string };
      return (
        cause.code === 11000 ||
        (typeof cause.message === 'string' && cause.message.includes('E11000'))
      );
    }
    return false;
  }
}

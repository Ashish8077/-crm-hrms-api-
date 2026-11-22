import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import {
  CompOffRepository,
  CompOffRecordLean,
} from '../repositories/comp-off-record.repository';
import { LeaveTypeRepository } from '../repositories/leave-type.repository';
import { LeaveBalanceRepository } from '../repositories/leave-balance.repository';
import { LeaveTransactionRepository } from '../repositories/leave-transaction.repository';
import {
  EmployeeRepository,
  EmployeeLean,
} from '../../employees/repositories/employee.repository';
import { AttendanceRepository } from '../../attendance/repositories/attendance.repository';
import { WeeklyOffService } from '../../work-schedules/services/weekly-off.service';
import { HolidayRepository } from '../repositories/holiday.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AuthorizationService } from '../../authorization/authorization.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../../audit-logs/constants/audit-log.constant';
import { PermissionKeys } from '../../permissions/constants/permission.constant';
import {
  CompOffStatus,
  LEAVES_CONSTANTS,
  LeaveTransactionType,
} from '../constants/leaves.constant';
import { AttendanceStatus } from '../../attendance/constants/attendance.constant';
import { EmploymentStatus } from '../../employees/constants/employee.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
import { LeaveCalculationUtil } from '../utils/leave-calculation.util';
import { ClaimCompOffDto } from '../dto/claim-comp-off.dto';
import { ReviewCompOffDto } from '../dto/review-comp-off.dto';
import { ListCompOffQueryDto } from '../dto/list-comp-off-query.dto';

export interface ClientMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class CompOffService {
  private readonly logger = new Logger(CompOffService.name);

  constructor(
    private readonly compOffRepo: CompOffRepository,
    private readonly leaveTypeRepo: LeaveTypeRepository,
    private readonly leaveBalanceRepo: LeaveBalanceRepository,
    private readonly leaveTransactionRepo: LeaveTransactionRepository,
    private readonly employeeRepo: EmployeeRepository,
    private readonly attendanceRepo: AttendanceRepository,
    private readonly holidayRepo: HolidayRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly authorizationService: AuthorizationService,
    @InjectConnection() private readonly connection: Connection,
    @Optional() private readonly weeklyOffService?: WeeklyOffService,
  ) {}

  /**
   * Helper: Resolves authenticated User ID to Employee profile.
   */
  private async getEmployeeForUser(
    userId: Types.ObjectId,
  ): Promise<EmployeeLean> {
    const employee = await this.employeeRepo.findByUserId(userId);
    if (!employee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Active employee profile required for this operation',
        HttpStatus.NOT_FOUND,
      );
    }
    return employee;
  }

  /**
   * Employee claims compensatory off for working on a weekend, public holiday, or overtime.
   */
  async claimCompOff(
    userId: Types.ObjectId,
    dto: ClaimCompOffDto,
    metadata?: ClientMetadata,
  ): Promise<CompOffRecordLean> {
    const employee = await this.getEmployeeForUser(userId);

    // Guard: Employment status
    if (
      employee.employmentStatus === EmploymentStatus.TERMINATED ||
      employee.employmentStatus === EmploymentStatus.RESIGNED
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `Employees with status ${employee.employmentStatus} cannot claim comp-off`,
        HttpStatus.FORBIDDEN,
      );
    }

    // Guard: Duplicate claim prevention for the same attendance date
    const existingClaim =
      await this.compOffRepo.findByEmployeeAndAttendanceDate(
        employee._id,
        dto.attendanceDate,
      );
    if (existingClaim) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Comp-off has already been claimed for attendance date ${dto.attendanceDate} with status ${existingClaim.status}`,
        HttpStatus.CONFLICT,
      );
    }

    // Guard: Attendance record validation
    const attendance = await this.attendanceRepo.findByEmployeeAndDate(
      employee._id,
      dto.attendanceDate,
    );
    if (!attendance) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `No attendance record found for date ${dto.attendanceDate}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      attendance.status === AttendanceStatus.ABSENT ||
      attendance.status === AttendanceStatus.ON_LEAVE
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Cannot claim comp-off for date ${dto.attendanceDate} where attendance status is ${attendance.status}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const overtimeMinutes = attendance.overtimeMinutes || 0;
    const workingMinutes = attendance.totalWorkMinutes || 0;

    // Check if the claimed date was a public or company holiday
    const holiday = employee.branchId
      ? await this.holidayRepo.findByDateAndBranch(
          dto.attendanceDate,
          employee.branchId,
        )
      : null;

    // Check if configured weekly off (dynamic branch schedule or fallback to Sunday)
    const isWeeklyOff = this.weeklyOffService
      ? await this.weeklyOffService.isWeeklyOff(
          dto.attendanceDate,
          employee.branchId,
        )
      : LeaveCalculationUtil.isWeekend(dto.attendanceDate, [0]);

    const isHolidayOrWeekendWork =
      (Boolean(holiday) || isWeeklyOff) && workingMinutes > 0;
    const hasOvertime = overtimeMinutes > 0;

    if (!isHolidayOrWeekendWork && !hasOvertime) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Date ${dto.attendanceDate} does not qualify for compensatory off (no overtime logged and not a weekend/holiday)`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Calculate earned compensatory days:
    // Full day (1.0) if worked >= 4 hours (240 mins), otherwise half day (0.5)
    const qualifyingMinutes = Math.max(overtimeMinutes, workingMinutes);
    const earnedDays = qualifyingMinutes >= 240 ? 1 : 0.5;

    // Expiry date calculation: attendanceDate + 90 days (UTC)
    const [year, month, day] = dto.attendanceDate.split('-').map(Number);
    const expDate = new Date(Date.UTC(year, month - 1, day));
    expDate.setUTCDate(
      expDate.getUTCDate() + LEAVES_CONSTANTS.DEFAULT_COMP_OFF_VALIDITY_DAYS,
    );
    const expiryDateStr = `${expDate.getUTCFullYear()}-${String(
      expDate.getUTCMonth() + 1,
    ).padStart(2, '0')}-${String(expDate.getUTCDate()).padStart(2, '0')}`;

    const compOff = await this.compOffRepo.create({
      employeeId: employee._id,
      attendanceDate: dto.attendanceDate,
      overtimeMinutes: qualifyingMinutes,
      earnedDays,
      status: CompOffStatus.PENDING,
      expiryDate: expiryDateStr,
      reason: dto.reason,
      createdBy: userId,
    });

    await this.auditLogsService.createAuditLog({
      actorId: userId,
      action: AuditAction.COMP_OFF_ACCRUED,
      targetId: compOff._id,
      targetModel: AuditTargetModel.COMP_OFF_RECORD,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
      details: {
        employeeId: employee._id.toString(),
        attendanceDate: dto.attendanceDate,
        overtimeMinutes: qualifyingMinutes,
        earnedDays,
        expiryDate: expiryDateStr,
      },
    });

    return compOff;
  }

  /**
   * Manager or HR reviews and approves/rejects a pending comp-off claim.
   * If approved, credits leave balance and creates an atomic COMP_OFF_CREDIT ledger transaction.
   */
  async reviewCompOff(
    actorId: Types.ObjectId,
    compOffId: Types.ObjectId,
    dto: ReviewCompOffDto,
    metadata?: ClientMetadata,
  ): Promise<CompOffRecordLean> {
    const compOff = await this.compOffRepo.findById(compOffId);
    if (!compOff) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Comp-off record not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (compOff.status !== CompOffStatus.PENDING) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Comp-off record has already been reviewed with status ${compOff.status}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const currentEmployee = await this.employeeRepo.findByUserId(actorId);

    // Guard: Self-review prohibition
    if (
      currentEmployee &&
      compOff.employeeId.toString() === currentEmployee._id.toString()
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Employees cannot review their own comp-off claims',
        HttpStatus.FORBIDDEN,
      );
    }

    const targetEmployee = await this.employeeRepo.findById(compOff.employeeId);
    if (!targetEmployee) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Target employee profile not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const isReportingManager =
      currentEmployee &&
      targetEmployee.reportingManagerId &&
      targetEmployee.reportingManagerId.toString() ===
        currentEmployee._id.toString();

    const hasApprovePermission =
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.COMP_OFF_REVIEW,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVES_APPROVE,
      ));

    if (!isReportingManager && !hasApprovePermission) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only the assigned reporting manager or authorized HR can review comp-off claims',
        HttpStatus.FORBIDDEN,
      );
    }

    const session = await this.connection.startSession();
    try {
      let reviewedRecord!: CompOffRecordLean;

      await session.withTransaction(async (s: ClientSession) => {
        if (dto.status === 'REJECTED') {
          const rejected = await this.compOffRepo.updateStatus(
            compOffId,
            CompOffStatus.PENDING,
            CompOffStatus.REJECTED,
            {
              reviewedBy: actorId,
              reviewedAt: new Date(),
              reviewRemarks: dto.remarks || null,
              updatedBy: actorId,
            },
            s,
          );

          if (!rejected) {
            throw new AppError(
              ErrorCode.RESOURCE_ALREADY_EXISTS,
              'Comp-off status transition conflict',
              HttpStatus.CONFLICT,
            );
          }

          reviewedRecord = rejected;

          await this.auditLogsService.createAuditLog(
            {
              actorId,
              action: AuditAction.COMP_OFF_REJECTED,
              targetId: compOffId,
              targetModel: AuditTargetModel.COMP_OFF_RECORD,
              ipAddress: metadata?.ipAddress ?? null,
              userAgent: metadata?.userAgent ?? null,
              details: {
                employeeId: compOff.employeeId.toString(),
                remarks: dto.remarks,
              },
            },
            s,
          );
        } else {
          // Status is APPROVED: credit comp-off days into employee's COMP_OFF leave balance
          const grantedDays = dto.earnedDays ?? compOff.earnedDays;

          // 1. Ensure COMP_OFF LeaveType exists
          let compOffType = await this.leaveTypeRepo.findByCode('COMP_OFF', s);
          if (!compOffType) {
            compOffType = await this.leaveTypeRepo.create(
              {
                name: 'Compensatory Off',
                code: 'COMP_OFF',
                description:
                  'Compensatory off earned by working overtime or holidays',
                isPaid: true,
                annualAllocation: 0,
                allowHalfDay: true,
                allowNegativeBalance: false,
                allowDuringNoticePeriod: false,
                isActive: true,
                createdBy: actorId,
              },
              s,
            );
          }

          // 2. Ensure LeaveBalance ledger exists for this employee, compOffType, and year
          const recordYear = parseInt(compOff.attendanceDate.split('-')[0], 10);
          const initialBalance = await this.leaveBalanceRepo.upsertAllocation(
            compOff.employeeId,
            compOffType._id,
            recordYear,
            0,
            0,
            actorId,
            s,
          );

          // 3. Increment creditedDays and availableBalance atomically
          const updatedBalance = await this.leaveBalanceRepo.manualAdjust(
            compOff.employeeId,
            compOffType._id,
            recordYear,
            'CREDIT',
            grantedDays,
            actorId,
            false,
            s,
          );

          if (!updatedBalance) {
            throw new AppError(
              ErrorCode.INTERNAL_SERVER_ERROR,
              'Failed to credit leave balance ledger for comp-off',
              HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }

          // 4. Create audit-grade LeaveTransaction
          await this.leaveTransactionRepo.create(
            {
              employeeId: compOff.employeeId,
              leaveTypeId: compOffType._id,
              year: recordYear,
              transactionType: LeaveTransactionType.COMP_OFF_CREDIT,
              days: grantedDays,
              previousAvailable: initialBalance.availableBalance,
              newAvailable: updatedBalance.availableBalance,
              referenceId: compOffId,
              referenceType: 'CompOffRecord',
              remarks: dto.remarks || 'Compensatory off approval credit',
              actorId,
            },
            s,
          );

          // 5. Update comp-off status to APPROVED
          const approved = await this.compOffRepo.updateStatus(
            compOffId,
            CompOffStatus.PENDING,
            CompOffStatus.APPROVED,
            {
              earnedDays: grantedDays,
              reviewedBy: actorId,
              reviewedAt: new Date(),
              reviewRemarks: dto.remarks || null,
              updatedBy: actorId,
            },
            s,
          );

          if (!approved) {
            throw new AppError(
              ErrorCode.RESOURCE_ALREADY_EXISTS,
              'Comp-off status transition conflict',
              HttpStatus.CONFLICT,
            );
          }

          reviewedRecord = approved;

          await this.auditLogsService.createAuditLog(
            {
              actorId,
              action: AuditAction.COMP_OFF_APPROVED,
              targetId: compOffId,
              targetModel: AuditTargetModel.COMP_OFF_RECORD,
              ipAddress: metadata?.ipAddress ?? null,
              userAgent: metadata?.userAgent ?? null,
              details: {
                employeeId: compOff.employeeId.toString(),
                grantedDays,
                newAvailableBalance: updatedBalance.availableBalance,
                remarks: dto.remarks,
              },
            },
            s,
          );
        }
      });

      return reviewedRecord;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Returns current employee's own comp-off records.
   */
  async getMyCompOff(
    userId: Types.ObjectId,
    query: ListCompOffQueryDto,
  ): Promise<PaginatedResult<CompOffRecordLean>> {
    const employee = await this.getEmployeeForUser(userId);
    const filter: Record<string, unknown> = { employeeId: employee._id };
    if (query.status) filter.status = query.status;

    return this.compOffRepo.findList(
      filter,
      query.page || 1,
      query.limit || 20,
      { createdAt: -1 },
    );
  }

  /**
   * Manager / HR lists comp-offs with RBAC scoping.
   */
  async listCompOff(
    actorId: Types.ObjectId,
    query: ListCompOffQueryDto,
  ): Promise<PaginatedResult<CompOffRecordLean>> {
    const currentEmployee = await this.employeeRepo.findByUserId(actorId);
    const hasViewPermission =
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.COMP_OFF_VIEW_TEAM,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.COMP_OFF_VIEW,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVES_VIEW,
      ));

    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;

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
          'Insufficient permissions to view comp-off records for this employee',
          HttpStatus.FORBIDDEN,
        );
      }

      filter.employeeId = targetEmpId;
    } else {
      if (hasViewPermission) {
        // HR with LEAVES_VIEW can see all records
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
          'Insufficient permissions to view comp-off records',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    return this.compOffRepo.findList(
      filter,
      query.page || 1,
      query.limit || 20,
      { createdAt: -1 },
    );
  }

  /**
   * Retrieves single comp-off record by ID with authorization checks.
   */
  async getCompOffById(
    actorId: Types.ObjectId,
    compOffId: Types.ObjectId,
  ): Promise<CompOffRecordLean> {
    const compOff = await this.compOffRepo.findById(compOffId);
    if (!compOff) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Comp-off record not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const currentEmployee = await this.employeeRepo.findByUserId(actorId);
    const isSelf =
      currentEmployee &&
      currentEmployee._id.toString() === compOff.employeeId.toString();

    const targetEmployee = await this.employeeRepo.findById(compOff.employeeId);
    const isReportingManager =
      currentEmployee &&
      targetEmployee?.reportingManagerId &&
      targetEmployee.reportingManagerId.toString() ===
        currentEmployee._id.toString();

    const hasViewPermission =
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.COMP_OFF_VIEW_TEAM,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.COMP_OFF_VIEW,
      )) ||
      (await this.authorizationService.hasPermission(
        actorId,
        PermissionKeys.LEAVES_VIEW,
      ));

    if (!isSelf && !isReportingManager && !hasViewPermission) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Insufficient permissions to view this comp-off record',
        HttpStatus.FORBIDDEN,
      );
    }

    return compOff;
  }
}

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { HttpStatus } from '@nestjs/common';
import { Connection, Types } from 'mongoose';
import { LeavesService } from './services/leaves.service';
import { LeaveTypeRepository } from './repositories/leave-type.repository';
import { LeaveBalanceRepository } from './repositories/leave-balance.repository';
import { LeaveTransactionRepository } from './repositories/leave-transaction.repository';
import {
  LeaveRequestRepository,
  LeaveRequestLean,
} from './repositories/leave-request.repository';
import { HolidayRepository } from './repositories/holiday.repository';
import { CompOffRepository } from './repositories/comp-off-record.repository';
import {
  EmployeeRepository,
  EmployeeLean,
} from '../employees/repositories/employee.repository';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { AttendanceRepository } from '../attendance/repositories/attendance.repository';
import { ShiftService } from '../attendance/services/shift.service';
import { WeeklyOffService } from '../work-schedules/services/weekly-off.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  LeaveRequestStatus,
  LeaveTransactionType,
  ReconcileCancellationAction,
} from './constants/leaves.constant';
import { AttendanceStatus } from '../attendance/constants/attendance.constant';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { EmploymentStatus } from '../employees/constants/employee.constant';
import { ReconcileLeaveCancellationDto } from './dto/reconcile-leave-cancellation.dto';

describe('HR Leave Cancellation Reconciliation Integration Spec (Tier 3 Policy)', () => {
  let service: LeavesService;

  const hrUserId = new Types.ObjectId();
  const hrEmployeeId = new Types.ObjectId();
  const regularEmployeeUserId = new Types.ObjectId();
  const regularEmployeeId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const leaveTypeId = new Types.ObjectId();
  const requestId = new Types.ObjectId();

  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const dateDay1 = fmt(new Date(now.getTime() - 5 * 86400000));
  const dateDay3 = fmt(new Date(now.getTime() - 3 * 86400000));
  const oldDate45DaysAgo = fmt(new Date(now.getTime() - 45 * 86400000));
  const oldDate43DaysAgo = fmt(new Date(now.getTime() - 43 * 86400000));

  const mockHrEmployee: EmployeeLean = {
    _id: hrEmployeeId,
    userId: hrUserId,
    firstName: 'HR',
    lastName: 'Admin',
    branchId,
    employmentStatus: EmploymentStatus.ACTIVE,
    dateOfJoining: new Date('2020-01-01'),
  } as unknown as EmployeeLean;

  const mockRegularEmployee: EmployeeLean = {
    _id: regularEmployeeId,
    userId: regularEmployeeUserId,
    firstName: 'John',
    lastName: 'Doe',
    branchId,
    employmentStatus: EmploymentStatus.ACTIVE,
    dateOfJoining: new Date('2021-01-01'),
  } as unknown as EmployeeLean;

  const mockLeaveRequest: LeaveRequestLean = {
    _id: requestId,
    employeeId: regularEmployeeId,
    leaveTypeId,
    startDate: dateDay1,
    endDate: dateDay3,
    totalDays: 3,
    yearBreakdown: [{ year: Number(dateDay1.slice(0, 4)), days: 3 }],
    status: LeaveRequestStatus.CANCELLATION_REQUESTED,
    cancellationReason:
      'Employee actually worked during requested leave period',
    reconciliationNotes:
      'Awaiting HR attendance reconciliation for past approved leave cancellation.',
    leaveTypeSnapshot: {
      code: 'CL',
      name: 'Casual Leave',
      isPaid: true,
      allowHalfDay: true,
      deductWeekends: false,
      deductHolidays: false,
    },
    approvalTimeline: [],
  } as unknown as LeaveRequestLean;

  let mockLeaveRequestRepo: any;
  let mockLeaveBalanceRepo: any;
  let mockLeaveTransactionRepo: any;
  let mockEmployeeRepo: any;
  let mockAttendanceRepo: any;
  let mockCompOffRepo: any;
  let mockHolidayRepo: any;
  let mockWeeklyOffService: any;
  let mockAuditLogsService: any;
  let mockAuthorizationService: any;
  let mockSession: any;
  let mockConnection: any;

  beforeEach(() => {
    mockSession = {
      withTransaction: jest.fn(async (cb: any) => cb(mockSession)),
      endSession: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
    };

    mockConnection = {
      startSession: jest.fn().mockResolvedValue(mockSession),
    };

    mockLeaveRequestRepo = {
      findById: jest.fn().mockResolvedValue({ ...mockLeaveRequest }),
      updateStatus: jest
        .fn()
        .mockImplementation((id, from, to, timeline, extra) => {
          return Promise.resolve({
            ...mockLeaveRequest,
            status: to,
            ...extra,
            approvalTimeline: [timeline],
          });
        }),
    };

    mockLeaveBalanceRepo = {
      creditCancelledBalance: jest.fn().mockResolvedValue({
        employeeId: regularEmployeeId,
        leaveTypeId,
        year: Number(dateDay1.slice(0, 4)),
        usedDays: 0,
        availableBalance: 12,
      }),
    };

    mockLeaveTransactionRepo = {
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    };

    mockEmployeeRepo = {
      findById: jest.fn().mockImplementation((id: Types.ObjectId) => {
        if (id.toString() === hrEmployeeId.toString())
          return Promise.resolve(mockHrEmployee);
        if (id.toString() === regularEmployeeId.toString())
          return Promise.resolve(mockRegularEmployee);
        return Promise.resolve(null);
      }),
      findByUserId: jest.fn().mockImplementation((uId: Types.ObjectId) => {
        if (uId.toString() === hrUserId.toString())
          return Promise.resolve(mockHrEmployee);
        if (uId.toString() === regularEmployeeUserId.toString())
          return Promise.resolve(mockRegularEmployee);
        return Promise.resolve(null);
      }),
    };

    mockAttendanceRepo = {
      removeFutureLeaveAttendance: jest.fn().mockResolvedValue(undefined),
      findByEmployeeAndDate: jest.fn().mockImplementation((_eId, date) => {
        return Promise.resolve({
          _id: new Types.ObjectId(),
          employeeId: regularEmployeeId,
          attendanceDate: date,
          leaveRequestId: requestId,
          checkInTime: new Date(`${date}T09:00:00.000Z`),
          checkOutTime: new Date(`${date}T18:00:00.000Z`),
          totalWorkMinutes: 540,
          shiftSnapshot: {
            minWorkMinutesForFullDay: 480,
            minWorkMinutesForHalfDay: 240,
          },
          status: AttendanceStatus.ON_LEAVE,
        });
      }),
      updateById: jest.fn().mockResolvedValue(null),
    };

    mockCompOffRepo = {
      revertCompOffRedemption: jest.fn().mockResolvedValue(undefined),
    };

    mockHolidayRepo = {
      findApplicableHolidays: jest.fn().mockResolvedValue([]),
    };

    mockWeeklyOffService = {
      isWeeklyOff: jest.fn().mockResolvedValue(false),
    };

    mockAuditLogsService = {
      createAuditLog: jest.fn().mockResolvedValue(undefined),
    };

    mockAuthorizationService = {
      hasPermission: jest.fn().mockImplementation((_uId, perm) => {
        if (perm === PermissionKeys.LEAVE_REQUESTS_APPROVE)
          return Promise.resolve(true);
        return Promise.resolve(false);
      }),
    };

    service = new LeavesService(
      {} as LeaveTypeRepository,
      mockHolidayRepo as HolidayRepository,
      mockLeaveBalanceRepo as LeaveBalanceRepository,
      mockLeaveRequestRepo as LeaveRequestRepository,
      mockLeaveTransactionRepo as LeaveTransactionRepository,
      mockCompOffRepo as CompOffRepository,
      mockEmployeeRepo as EmployeeRepository,
      {} as BranchRepository,
      mockAttendanceRepo as AttendanceRepository,
      {} as ShiftService,
      mockAuditLogsService as AuditLogsService,
      mockAuthorizationService as AuthorizationService,
      mockConnection as Connection,
      mockWeeklyOffService as WeeklyOffService,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. FULL REFUND (APPROVE)
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 1: should approve full refund and transition request to CANCELLED with ledger credit', async () => {
    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks:
        'Verified employee was present in office for all 3 requested days',
      actualAttendanceDetails:
        'Biometric swipe records verified for full duration',
      refundedDays: 3,
    };

    const result = await service.reconcileLeaveCancellation(
      hrUserId,
      requestId,
      dto,
    );

    expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
    expect(mockLeaveRequestRepo.updateStatus).toHaveBeenCalledWith(
      requestId,
      LeaveRequestStatus.CANCELLATION_REQUESTED,
      LeaveRequestStatus.CANCELLED,
      expect.objectContaining({
        approverId: hrUserId,
        fromStatus: LeaveRequestStatus.CANCELLATION_REQUESTED,
        toStatus: LeaveRequestStatus.CANCELLED,
        isOverride: true,
      }),
      expect.objectContaining({
        cancellationReviewedBy: hrUserId,
        reconciliationNotes: expect.stringContaining('Refunded: 3 of 3 days'),
      }),
      mockSession,
    );

    expect(mockLeaveBalanceRepo.creditCancelledBalance).toHaveBeenCalledWith(
      regularEmployeeId,
      leaveTypeId,
      Number(dateDay1.slice(0, 4)),
      3,
      hrUserId,
      mockSession,
    );

    expect(mockLeaveTransactionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: regularEmployeeId,
        leaveTypeId,
        transactionType: LeaveTransactionType.CANCELLATION_CREDIT,
        days: 3,
        referenceId: requestId,
        referenceType: 'LeaveRequest',
      }),
      mockSession,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. PARTIAL REFUND WITH DATES WORKED
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 2: should approve partial refund when datesWorked is supplied and matches verified attendance', async () => {
    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks:
        'Employee worked on dateDay1 only; remaining days stayed on leave',
      actualAttendanceDetails: 'Verified biometric presence on dateDay1',
      datesWorked: [dateDay1],
      refundedDays: 1,
    };

    const result = await service.reconcileLeaveCancellation(
      hrUserId,
      requestId,
      dto,
    );

    expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
    expect(mockLeaveBalanceRepo.creditCancelledBalance).toHaveBeenCalledWith(
      regularEmployeeId,
      leaveTypeId,
      Number(dateDay1.slice(0, 4)),
      1,
      hrUserId,
      mockSession,
    );

    expect(mockAttendanceRepo.updateById).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        leaveRequestId: null,
        status: AttendanceStatus.PRESENT,
      }),
      mockSession,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2b. PARTIAL REFUND REJECTED IF DATES WORKED IS MISSING
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 2b: should reject partial refund with 400 Bad Request when datesWorked is missing', async () => {
    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Attempting partial refund without datesWorked',
      actualAttendanceDetails: 'Vague notes',
      refundedDays: 1,
    };

    await expect(
      service.reconcileLeaveCancellation(hrUserId, requestId, dto),
    ).rejects.toThrow(
      'Specific datesWorked must be provided for partial leave cancellation refunds',
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2c. MISMATCHED REFUND INPUTS CONFLICT REJECTION
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 2c: should reject when refundedDays conflicts with datesWorked', async () => {
    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Conflicting inputs',
      actualAttendanceDetails: 'Notes',
      datesWorked: [dateDay1], // 1 day
      refundedDays: 2, // Conflicting 2 days
    };

    await expect(
      service.reconcileLeaveCancellation(hrUserId, requestId, dto),
    ).rejects.toThrow('Mismatched refund inputs');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. ZERO REFUNDABLE DAYS (APPROVE WITHOUT BALANCE REFUND)
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 3: should approve cancellation with 0 refundable days without balance or ledger modifications', async () => {
    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks:
        'Audit confirmed employee did not work; formalizing cancellation',
      actualAttendanceDetails: 'No punches found',
      refundedDays: 0,
    };

    const result = await service.reconcileLeaveCancellation(
      hrUserId,
      requestId,
      dto,
    );

    expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
    expect(mockLeaveBalanceRepo.creditCancelledBalance).not.toHaveBeenCalled();
    expect(mockLeaveTransactionRepo.create).not.toHaveBeenCalled();
    expect(mockAuditLogsService.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          refundedDays: 0,
        }),
      }),
      mockSession,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. CROSS-YEAR RECONCILIATION
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 4: should reconcile cross-year leave and credit each year independently', async () => {
    const crossYearDay2026 = '2026-12-31';
    const crossYearDay2027 = '2027-01-01';

    const crossYearRequest: LeaveRequestLean = {
      ...mockLeaveRequest,
      startDate: crossYearDay2026,
      endDate: crossYearDay2027,
      totalDays: 2,
      yearBreakdown: [
        { year: 2026, days: 1 },
        { year: 2027, days: 1 },
      ],
    };
    mockLeaveRequestRepo.findById.mockResolvedValue(crossYearRequest);

    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Employee worked 1 day in 2026 and 1 day in 2027',
      actualAttendanceDetails: 'Verified shifts on 2026-12-31 and 2027-01-01',
      datesWorked: [crossYearDay2026, crossYearDay2027],
      yearBreakdown: [
        { year: 2026, days: 1 },
        { year: 2027, days: 1 },
      ],
    };

    const result = await service.reconcileLeaveCancellation(
      hrUserId,
      requestId,
      dto,
    );

    expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
    expect(mockLeaveBalanceRepo.creditCancelledBalance).toHaveBeenCalledTimes(
      2,
    );
    expect(mockLeaveBalanceRepo.creditCancelledBalance).toHaveBeenCalledWith(
      regularEmployeeId,
      leaveTypeId,
      2026,
      1,
      hrUserId,
      mockSession,
    );
    expect(mockLeaveBalanceRepo.creditCancelledBalance).toHaveBeenCalledWith(
      regularEmployeeId,
      leaveTypeId,
      2027,
      1,
      hrUserId,
      mockSession,
    );

    expect(mockLeaveTransactionRepo.create).toHaveBeenCalledTimes(2);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. BIOMETRIC ATTENDANCE PRESERVATION & STATUS CALCULATION
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 5: should calculate HALF_DAY status when totalWorkingMinutes is between half-day and full-day threshold', async () => {
    mockAttendanceRepo.findByEmployeeAndDate.mockResolvedValue({
      _id: new Types.ObjectId(),
      employeeId: regularEmployeeId,
      attendanceDate: dateDay1,
      leaveRequestId: requestId,
      checkInTime: new Date(`${dateDay1}T09:00:00.000Z`),
      checkOutTime: new Date(`${dateDay1}T14:00:00.000Z`),
      totalWorkMinutes: 300, // 5 hours -> HALF_DAY
      shiftSnapshot: {
        minWorkMinutesForFullDay: 480,
        minWorkMinutesForHalfDay: 240,
      },
      status: AttendanceStatus.ON_LEAVE,
    });

    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Employee worked 5 hours on dateDay1',
      actualAttendanceDetails: 'Biometric records show 300 minutes worked',
      datesWorked: [dateDay1],
      refundedDays: 0.5,
    };

    const result = await service.reconcileLeaveCancellation(
      hrUserId,
      requestId,
      dto,
    );

    expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
    expect(mockAttendanceRepo.updateById).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        leaveRequestId: null,
        status: AttendanceStatus.HALF_DAY,
      }),
      mockSession,
    );
    expect(mockLeaveBalanceRepo.creditCancelledBalance).toHaveBeenCalledWith(
      regularEmployeeId,
      leaveTypeId,
      Number(dateDay1.slice(0, 4)),
      0.5,
      hrUserId,
      mockSession,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. REJECTED RECONCILIATION (REVERT TO APPROVED)
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 6: should reject cancellation, transition request back to APPROVED, and keep leave deduction', async () => {
    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.REJECT,
      remarks:
        'Investigation confirmed employee was absent; cancellation rejected',
      actualAttendanceDetails: 'No punches and manager confirmed absence',
    };

    const result = await service.reconcileLeaveCancellation(
      hrUserId,
      requestId,
      dto,
    );

    expect(result.status).toBe(LeaveRequestStatus.APPROVED);
    expect(mockLeaveRequestRepo.updateStatus).toHaveBeenCalledWith(
      requestId,
      LeaveRequestStatus.CANCELLATION_REQUESTED,
      LeaveRequestStatus.APPROVED,
      expect.objectContaining({
        fromStatus: LeaveRequestStatus.CANCELLATION_REQUESTED,
        toStatus: LeaveRequestStatus.APPROVED,
        isOverride: true,
      }),
      expect.objectContaining({
        cancellationReviewedBy: hrUserId,
        reconciliationNotes: expect.stringContaining(
          'Cancellation rejected by HR',
        ),
      }),
      mockSession,
    );

    expect(mockLeaveBalanceRepo.creditCancelledBalance).not.toHaveBeenCalled();
    expect(mockLeaveTransactionRepo.create).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. DUPLICATE / IDEMPOTENCY PROTECTION
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 7a: should reject reconciliation if request is not in CANCELLATION_REQUESTED status', async () => {
    mockLeaveRequestRepo.findById.mockResolvedValue({
      ...mockLeaveRequest,
      status: LeaveRequestStatus.CANCELLED,
    });

    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Attempting second reconciliation',
      actualAttendanceDetails: 'N/A',
      refundedDays: 3,
    };

    await expect(
      service.reconcileLeaveCancellation(hrUserId, requestId, dto),
    ).rejects.toThrow(
      new AppError(
        ErrorCode.VALIDATION_ERROR,
        "Cannot reconcile leave request in status 'CANCELLED': request must be in 'CANCELLATION_REQUESTED' status",
        HttpStatus.BAD_REQUEST,
      ),
    );
  });

  it('Scenario 7b: should reject with 409 Conflict if atomic status update returns null (concurrent race condition)', async () => {
    mockLeaveRequestRepo.updateStatus.mockResolvedValue(null);

    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Concurrent reconciliation race condition',
      actualAttendanceDetails: 'Verified records',
      refundedDays: 3,
    };

    await expect(
      service.reconcileLeaveCancellation(hrUserId, requestId, dto),
    ).rejects.toThrow(
      new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        'Cannot reconcile leave request: request is not in CANCELLATION_REQUESTED status',
        HttpStatus.CONFLICT,
      ),
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. SERVER-SIDE PAYROLL SAFETY CHECK & BYPASS PREVENTION
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 8a: should reject with 409 Conflict when leave date exceeds server-side payroll cutoff even if isPayrollProcessed is false or omitted', async () => {
    mockLeaveRequestRepo.findById.mockResolvedValue({
      ...mockLeaveRequest,
      startDate: oldDate45DaysAgo, // 45 days ago -> exceeds 30-day payroll cutoff
      endDate: oldDate43DaysAgo,
    });

    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Attempting historical reconciliation',
      actualAttendanceDetails: 'Verified punches from 45 days ago',
      refundedDays: 3,
      isPayrollProcessed: false, // Client claims payroll is not processed!
    };

    await expect(
      service.reconcileLeaveCancellation(hrUserId, requestId, dto),
    ).rejects.toThrow('exceeding the server-side payroll safety window');
  });

  it('Scenario 8b: should reject with 409 Conflict when isPayrollProcessed is explicitly true', async () => {
    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Recent leave cancellation',
      actualAttendanceDetails: 'Verified punches',
      refundedDays: 3,
      isPayrollProcessed: true,
    };

    await expect(
      service.reconcileLeaveCancellation(hrUserId, requestId, dto),
    ).rejects.toThrow('payroll has already been processed');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. LEGACY REQUESTS WITHOUT EXCLUDED DATES FALLBACK
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 9: should resolve holidays and weekly offs dynamically for legacy requests lacking excludedDates', async () => {
    const legacyRequest: LeaveRequestLean = {
      ...mockLeaveRequest,
      excludedDates: undefined, // Legacy document without pre-stored excluded dates
    };
    mockLeaveRequestRepo.findById.mockResolvedValue(legacyRequest);
    mockWeeklyOffService.isWeeklyOff.mockResolvedValue(true); // Sunday is weekly off

    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Attempting to refund a weekly off on a legacy request',
      actualAttendanceDetails: 'Sunday',
      datesWorked: [dateDay1],
      refundedDays: 1,
    };

    await expect(
      service.reconcileLeaveCancellation(hrUserId, requestId, dto),
    ).rejects.toThrow(
      `Date '${dateDay1}' in datesWorked was excluded as a holiday or weekly-off in the original request and cannot be refunded`,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. PERMISSIONS & SELF-RECONCILIATION GUARD
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 10a: should reject reconciliation with 403 Forbidden when user lacks HR permission', async () => {
    const anotherEmployeeUserId = new Types.ObjectId();
    const anotherEmployeeId = new Types.ObjectId();
    mockEmployeeRepo.findByUserId.mockImplementation((uId: Types.ObjectId) => {
      if (uId.toString() === anotherEmployeeUserId.toString()) {
        return Promise.resolve({
          _id: anotherEmployeeId,
          userId: anotherEmployeeUserId,
          employmentStatus: EmploymentStatus.ACTIVE,
        });
      }
      return Promise.resolve(null);
    });
    mockAuthorizationService.hasPermission.mockResolvedValue(false);

    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Unauthorized attempt',
      actualAttendanceDetails: 'N/A',
      refundedDays: 3,
    };

    await expect(
      service.reconcileLeaveCancellation(anotherEmployeeUserId, requestId, dto),
    ).rejects.toThrow(
      new AppError(
        ErrorCode.FORBIDDEN,
        'Only authorized HR/admin users can reconcile leave cancellations',
        HttpStatus.FORBIDDEN,
      ),
    );
  });

  it('Scenario 10b: should reject with 403 Forbidden when HR user attempts to reconcile their own leave request', async () => {
    mockLeaveRequestRepo.findById.mockResolvedValue({
      ...mockLeaveRequest,
      employeeId: hrEmployeeId, // Leave belongs to HR employee
    });

    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Self-reconciliation attempt',
      actualAttendanceDetails: 'I worked this day',
      refundedDays: 3,
    };

    await expect(
      service.reconcileLeaveCancellation(hrUserId, requestId, dto),
    ).rejects.toThrow(
      new AppError(
        ErrorCode.FORBIDDEN,
        'Employees cannot reconcile their own leave cancellation requests',
        HttpStatus.FORBIDDEN,
      ),
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11. LIFECYCLE PROTECTION (PREVENT APPROVAL / REJECTION / CANCELLATION)
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 11a: approveLeave should reject when request is in CANCELLATION_REQUESTED status', async () => {
    mockLeaveRequestRepo.findById.mockResolvedValue({ ...mockLeaveRequest });
    mockLeaveRequestRepo.updateStatus.mockResolvedValue(null);

    await expect(
      service.approveLeave(hrUserId, requestId, {
        remarks: 'Cannot approve while in reconciliation',
      }),
    ).rejects.toThrow(
      new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        'Cannot approve leave request: request is not in PENDING status',
        HttpStatus.CONFLICT,
      ),
    );
  });

  it('Scenario 11b: cancelLeave should reject when request is already in CANCELLATION_REQUESTED status', async () => {
    mockLeaveRequestRepo.findById.mockResolvedValue({ ...mockLeaveRequest });

    await expect(
      service.cancelLeave(regularEmployeeUserId, requestId, {
        reason: 'Duplicate cancellation attempt',
      }),
    ).rejects.toThrow(
      new AppError(
        ErrorCode.VALIDATION_ERROR,
        "Cannot cancel leave request in status 'CANCELLATION_REQUESTED'",
        HttpStatus.BAD_REQUEST,
      ),
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 12. TRANSACTION ROLLBACK ON FAILURE
  // ─────────────────────────────────────────────────────────────────────────
  it('Scenario 12: should roll back transaction if ledger transaction creation fails', async () => {
    mockLeaveTransactionRepo.create.mockRejectedValue(
      new Error('Database write failure'),
    );

    const dto: ReconcileLeaveCancellationDto = {
      action: ReconcileCancellationAction.APPROVE,
      remarks: 'Ledger failure simulation',
      actualAttendanceDetails: 'Verified records',
      refundedDays: 3,
    };

    await expect(
      service.reconcileLeaveCancellation(hrUserId, requestId, dto),
    ).rejects.toThrow('Database write failure');
    expect(mockSession.endSession).toHaveBeenCalled();
  });
});

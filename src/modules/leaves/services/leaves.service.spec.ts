/* eslint-disable @typescript-eslint/unbound-method */
import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { LeavesService } from './leaves.service';
import {
  LeaveTypeRepository,
  LeaveTypeLean,
} from '../repositories/leave-type.repository';
import { PaginatedResult } from '../../../common/pagination/types/pagination.types';
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
import {
  CompOffRepository,
  CompOffRecordLean,
} from '../repositories/comp-off-record.repository';
import {
  EmployeeRepository,
  EmployeeLean,
} from '../../employees/repositories/employee.repository';
import { BranchRepository } from '../../branches/repositories/branch.repository';
import { Branch } from '../../branches/schemas/branch.schema';
import { AttendanceRepository } from '../../attendance/repositories/attendance.repository';
import { ShiftService } from '../../attendance/services/shift.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AuditAction } from '../../audit-logs/constants/audit-log.constant';
import { AuthorizationService } from '../../authorization/authorization.service';
import { WeeklyOffService } from '../../work-schedules/services/weekly-off.service';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  HalfDaySession,
  LeaveRequestStatus,
  LeaveTransactionType,
  CompOffStatus,
  HolidayType,
} from '../constants/leaves.constant';
import {
  EmploymentStatus,
  EmploymentType,
} from '../../employees/constants/employee.constant';
import { ShiftLean } from '../../attendance/repositories/shift.repository';
import { AdjustLeaveBalanceDto } from '../dto/adjust-leave-balance.dto';

describe('LeavesService', () => {
  let service: LeavesService;
  let leaveTypeRepo: jest.Mocked<LeaveTypeRepository>;
  let holidayRepo: jest.Mocked<HolidayRepository>;
  let leaveBalanceRepo: jest.Mocked<LeaveBalanceRepository>;
  let leaveRequestRepo: jest.Mocked<LeaveRequestRepository>;
  let leaveTransactionRepo: jest.Mocked<LeaveTransactionRepository>;
  let compOffRepo: jest.Mocked<CompOffRepository>;
  let employeeRepo: jest.Mocked<EmployeeRepository>;
  let branchRepo: jest.Mocked<BranchRepository>;
  let attendanceRepo: jest.Mocked<AttendanceRepository>;
  let shiftService: jest.Mocked<ShiftService>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let authorizationService: jest.Mocked<AuthorizationService>;
  let weeklyOffService: jest.Mocked<WeeklyOffService>;

  const mockSession = {
    withTransaction: jest
      .fn()
      .mockImplementation((cb: (session: unknown) => unknown) =>
        cb(mockSession),
      ),
    endSession: jest.fn(),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };

  const actorUserId = new Types.ObjectId();
  const managerUserId = new Types.ObjectId();
  const peerUserId = new Types.ObjectId();

  const employeeId = new Types.ObjectId();
  const managerEmployeeId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const shiftId = new Types.ObjectId();
  const leaveTypeId = new Types.ObjectId();
  const requestId = new Types.ObjectId();

  const mockEmployee: EmployeeLean = {
    _id: employeeId,
    userId: actorUserId,
    employeeCode: 'EMP-0001',
    firstName: 'Alice',
    lastName: 'Smith',
    workEmail: 'alice@example.com',
    dateOfJoining: new Date('2026-01-01'),
    departmentId: new Types.ObjectId(),
    designationId: new Types.ObjectId(),
    branchId,
    teamId: null,
    reportingManagerId: managerEmployeeId,
    shiftId,
    employmentType: EmploymentType.FULL_TIME,
    employmentStatus: EmploymentStatus.ACTIVE,
    bankDetails: null,
    emergencyContact: null,
    skills: [],
    certifications: [],
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
  };

  const mockManager: EmployeeLean = {
    _id: managerEmployeeId,
    userId: managerUserId,
    employeeCode: 'EMP-0002',
    firstName: 'Bob',
    lastName: 'Manager',
    workEmail: 'bob@example.com',
    dateOfJoining: new Date('2025-01-01'),
    departmentId: mockEmployee.departmentId,
    designationId: new Types.ObjectId(),
    branchId,
    teamId: null,
    reportingManagerId: null,
    shiftId,
    employmentType: EmploymentType.FULL_TIME,
    employmentStatus: EmploymentStatus.ACTIVE,
    bankDetails: null,
    emergencyContact: null,
    skills: [],
    certifications: [],
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
  };

  const mockLeaveType: LeaveTypeLean = {
    _id: leaveTypeId,
    name: 'Paid Casual Leave',
    code: 'CL',
    isPaid: true,
    annualAllocation: 12,
    allowHalfDay: true,
    allowNegativeBalance: false,
    allowDuringNoticePeriod: false,
    applicableEmploymentStatuses: [
      EmploymentStatus.ACTIVE,
      EmploymentStatus.PROBATION,
    ],
    deductWeekends: false,
    deductHolidays: false,
    maxConsecutiveDays: 5,
    requiresAttachment: false,
    isCarryForwardEnabled: false,
    maxCarryForwardDays: 0,
    isActive: true,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockBalance: LeaveBalanceLean = {
    _id: new Types.ObjectId(),
    employeeId,
    leaveTypeId,
    year: 2026,
    allocatedDays: 12,
    carriedForwardDays: 0,
    creditedDays: 0,
    debitedDays: 0,
    pendingDays: 0,
    usedDays: 0,
    availableBalance: 12,
    deletedAt: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockShift: ShiftLean = {
    _id: shiftId,
    name: 'General Shift',
    code: 'GEN',
    startTime: '09:00',
    endTime: '18:00',
    isOvernight: false,
    gracePeriodMinutes: 15,
    breakDurationMinutes: 60,
    minWorkMinutesForFullDay: 480,
    minWorkMinutesForHalfDay: 240,
    overtimeThresholdMinutes: 480,
    isDefault: true,
    isActive: true,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const pendingRequest: LeaveRequestLean = {
    _id: requestId,
    employeeId: mockEmployee._id,
    leaveTypeId,
    startDate: '2026-08-01',
    endDate: '2026-08-02',
    totalDays: 2,
    yearBreakdown: [{ year: 2026, days: 2 }],
    status: LeaveRequestStatus.PENDING,
    leaveTypeSnapshot: {
      code: 'CL',
      name: 'Casual Leave',
      isPaid: true,
      deductWeekends: false,
      deductHolidays: false,
    },
  } as unknown as LeaveRequestLean;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeavesService,
        {
          provide: LeaveTypeRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByCode: jest.fn(),
            findList: jest.fn(),
            updateById: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: HolidayRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByDateAndBranch: jest.fn().mockResolvedValue(null),
            findApplicableHolidays: jest.fn().mockResolvedValue([]),
            findHolidaysInRange: jest.fn().mockResolvedValue([]),
            findList: jest.fn(),
            updateById: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: LeaveBalanceRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByEmployeeTypeYear: jest.fn(),
            findAllByEmployeeAndYear: jest.fn(),
            upsertAllocation: jest.fn(),
            reserveBalance: jest.fn(),
            releaseReservation: jest.fn(),
            debitApprovedBalance: jest.fn(),
            creditCancelledBalance: jest.fn(),
            manualAdjust: jest.fn(),
          },
        },
        {
          provide: LeaveRequestRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findOverlappingRequests: jest.fn().mockResolvedValue([]),
            findList: jest.fn(),
            findPendingApprovalsByManager: jest.fn(),
            updateStatus: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: LeaveTransactionRepository,
          useValue: {
            create: jest.fn(),
            findList: jest.fn(),
            findCarryForwardTransaction: jest.fn(),
          },
        },
        {
          provide: CompOffRepository,
          useValue: {
            findAvailableCompOffs: jest.fn().mockResolvedValue([]),
            redeemCompOff: jest.fn().mockResolvedValue({}),
            revertCompOffRedemption: jest.fn().mockResolvedValue(1),
          },
        },
        {
          provide: EmployeeRepository,
          useValue: {
            findByUserId: jest.fn(),
            findById: jest.fn(),
            findList: jest.fn().mockResolvedValue({ data: [], meta: {} }),
            findByReportingManager: jest.fn().mockResolvedValue([]),
            updateById: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: BranchRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue({ _id: branchId }),
          },
        },
        {
          provide: AttendanceRepository,
          useValue: {
            syncLeaveAttendance: jest.fn().mockResolvedValue({}),
            removeFutureLeaveAttendance: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: ShiftService,
          useValue: {
            resolveShift: jest.fn().mockResolvedValue(mockShift),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            hasPermission: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: WeeklyOffService,
          useValue: {
            getWeeklyOffDatesForRange: jest.fn().mockResolvedValue(new Set()),
            isWeeklyOff: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<LeavesService>(LeavesService);
    leaveTypeRepo = module.get(LeaveTypeRepository);
    holidayRepo = module.get(HolidayRepository);
    leaveBalanceRepo = module.get(LeaveBalanceRepository);
    leaveRequestRepo = module.get(LeaveRequestRepository);
    leaveTransactionRepo = module.get(LeaveTransactionRepository);
    compOffRepo = module.get(CompOffRepository);
    employeeRepo = module.get(EmployeeRepository);
    branchRepo = module.get(BranchRepository);
    attendanceRepo = module.get(AttendanceRepository);
    shiftService = module.get(ShiftService);
    auditLogsService = module.get(AuditLogsService);
    authorizationService = module.get(AuthorizationService);
    weeklyOffService = module.get(WeeklyOffService);
    authorizationService.hasPermission.mockResolvedValue(true);
    leaveTransactionRepo.findCarryForwardTransaction.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // 1. PROBATION & NOTICE PERIOD ELIGIBILITY (DECISION 1)
  // ===========================================================================

  describe('Decision 1: Probation & Notice Period Eligibility', () => {
    it('should allow probation employee to apply when leave type permits PROBATION', async () => {
      const probationEmp: EmployeeLean = {
        ...mockEmployee,
        employmentStatus: EmploymentStatus.PROBATION,
      };
      employeeRepo.findByUserId.mockResolvedValue(probationEmp);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      leaveBalanceRepo.reserveBalance.mockResolvedValue({
        ...mockBalance,
        pendingDays: 2,
        availableBalance: 10,
      });
      leaveRequestRepo.create.mockResolvedValue({
        _id: requestId,
        employeeId: probationEmp._id,
        leaveTypeId,
        status: LeaveRequestStatus.PENDING,
        totalDays: 2,
      } as unknown as LeaveRequestLean);

      const result = await service.applyLeave(actorUserId, {
        leaveTypeId: leaveTypeId.toString(),
        startDate: '2026-05-11', // Monday
        endDate: '2026-05-12', // Tuesday
        reason: 'Personal errand',
      });

      expect(result).toBeDefined();
      expect(holidayRepo.findApplicableHolidays).toHaveBeenCalledWith(
        '2026-05-11',
        '2026-05-12',
        branchId,
      );
      expect(leaveBalanceRepo.reserveBalance).toHaveBeenCalledWith(
        probationEmp._id,
        leaveTypeId,
        2026,
        2,
        false,
        actorUserId,
        expect.anything(),
      );
    });

    it('should block probation employee when leave type excludes PROBATION', async () => {
      const probationEmp: EmployeeLean = {
        ...mockEmployee,
        employmentStatus: EmploymentStatus.PROBATION,
      };
      employeeRepo.findByUserId.mockResolvedValue(probationEmp);
      const restrictedLeaveType: LeaveTypeLean = {
        ...mockLeaveType,
        applicableEmploymentStatuses: [EmploymentStatus.ACTIVE], // Only confirmed active
      };
      leaveTypeRepo.findById.mockResolvedValue(restrictedLeaveType);

      await expect(
        service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-05-11',
          endDate: '2026-05-12',
          reason: 'Attempt during probation',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          "Employees on 'probation' are not eligible for 'Paid Casual Leave'",
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('should block notice period employee when allowDuringNoticePeriod is false', async () => {
      const noticeEmp: EmployeeLean = {
        ...mockEmployee,
        employmentStatus: EmploymentStatus.NOTICE_PERIOD,
      };
      employeeRepo.findByUserId.mockResolvedValue(noticeEmp);
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        applicableEmploymentStatuses: [
          EmploymentStatus.ACTIVE,
          EmploymentStatus.NOTICE_PERIOD,
        ],
        allowDuringNoticePeriod: false,
      });

      await expect(
        service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-05-11',
          endDate: '2026-05-12',
          reason: 'Vacation during notice period',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          "'Paid Casual Leave' cannot be taken during notice period per company policy",
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should allow notice period employee when allowDuringNoticePeriod is true (e.g. Unpaid/Sick)', async () => {
      const noticeEmp: EmployeeLean = {
        ...mockEmployee,
        employmentStatus: EmploymentStatus.NOTICE_PERIOD,
      };
      employeeRepo.findByUserId.mockResolvedValue(noticeEmp);
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        applicableEmploymentStatuses: [
          EmploymentStatus.ACTIVE,
          EmploymentStatus.NOTICE_PERIOD,
        ],
        allowDuringNoticePeriod: true,
      });
      leaveBalanceRepo.reserveBalance.mockResolvedValue({
        ...mockBalance,
        pendingDays: 1,
        availableBalance: 11,
      });
      leaveRequestRepo.create.mockResolvedValue({
        _id: requestId,
        status: LeaveRequestStatus.PENDING,
      } as unknown as LeaveRequestLean);

      const result = await service.applyLeave(actorUserId, {
        leaveTypeId: leaveTypeId.toString(),
        startDate: '2026-05-11',
        endDate: '2026-05-11',
        reason: 'Emergency medical consultation',
      });

      expect(result).toBeDefined();
    });

    it('should allow notice period employee when allowDuringNoticePeriod is true even if applicableEmploymentStatuses only specifies active/probation', async () => {
      const noticeEmp: EmployeeLean = {
        ...mockEmployee,
        employmentStatus: EmploymentStatus.NOTICE_PERIOD,
      };
      employeeRepo.findByUserId.mockResolvedValue(noticeEmp);
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        applicableEmploymentStatuses: [
          EmploymentStatus.ACTIVE,
          EmploymentStatus.PROBATION,
        ],
        allowDuringNoticePeriod: true,
      });
      leaveBalanceRepo.reserveBalance.mockResolvedValue({
        ...mockBalance,
        pendingDays: 1,
        availableBalance: 11,
      });
      leaveRequestRepo.create.mockResolvedValue({
        _id: requestId,
        status: LeaveRequestStatus.PENDING,
      } as unknown as LeaveRequestLean);

      const result = await service.applyLeave(actorUserId, {
        leaveTypeId: leaveTypeId.toString(),
        startDate: '2026-05-11',
        endDate: '2026-05-11',
        reason: 'Emergency medical consultation',
      });

      expect(result).toBeDefined();
    });

    it('should forbid terminated or resigned employees from applying for leave', async () => {
      const terminatedEmp: EmployeeLean = {
        ...mockEmployee,
        employmentStatus: EmploymentStatus.TERMINATED,
      };
      employeeRepo.findByUserId.mockResolvedValue(terminatedEmp);

      await expect(
        service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-05-11',
          endDate: '2026-05-12',
          reason: 'Post-termination leave',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          "Employees with status 'terminated' cannot apply for leave",
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('7.5-7.7 (Apply Leave): should reject leave application when requested duration exceeds maxConsecutiveDays', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        maxConsecutiveDays: 5,
      });

      // 2026-06-01 (Mon) to 2026-06-06 (Sat) = 6 working days
      await expect(
        service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-06-01',
          endDate: '2026-06-06',
          reason: 'Extended personal leave exceeding limit',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Leave duration (6 days) exceeds maximum consecutive limit of 5 days',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    describe('Leave calculation for deductWeekends and deductHolidays (All 4 Combinations & Multi-Year)', () => {
      // Span: 2026-12-30 (Wed) to 2027-01-04 (Mon) = 6 calendar days
      // 2026-12-30: Wed (Working)
      // 2026-12-31: Thu (Working)
      // 2027-01-01: Fri (Holiday in Holiday Calendar)
      // 2027-01-02: Sat (Configured Weekly Off)
      // 2027-01-03: Sun (Configured Weekly Off)
      // 2027-01-04: Mon (Working)
      const mockMultiYearHoliday: HolidayLean = {
        _id: new Types.ObjectId(),
        name: "New Year's Day",
        date: '2027-01-01',
        type: HolidayType.PUBLIC,
        branchId: null,
        year: 2027,
        isActive: true,
        deletedAt: null,
        createdBy: null,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      beforeEach(() => {
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        leaveRequestRepo.findOverlappingRequests.mockResolvedValue([]);
        holidayRepo.findApplicableHolidays.mockResolvedValue([
          mockMultiYearHoliday,
        ]);
        weeklyOffService.getWeeklyOffDatesForRange.mockResolvedValue(
          new Set(['2027-01-02', '2027-01-03']),
        );
        leaveBalanceRepo.reserveBalance.mockResolvedValue({
          ...mockBalance,
          pendingDays: 4,
          availableBalance: 8,
        });
        leaveRequestRepo.create.mockImplementation((payload) =>
          Promise.resolve({
            _id: requestId,
            ...payload,
          } as unknown as LeaveRequestLean),
        );
      });

      it('Combination 1 (deductWeekends: false, deductHolidays: false): should exclude weekly offs and holidays across both years', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          deductWeekends: false,
          deductHolidays: false,
          maxConsecutiveDays: 30,
        });

        const result = await service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-12-30',
          endDate: '2027-01-04',
          reason: 'Combination 1 multi-year vacation',
        });

        // 2026: Dec 30, 31 = 2 days
        // 2027: Jan 01 (hldy excluded), Jan 02 & 03 (wknd excluded), Jan 04 = 1 day
        // Total = 3 days
        expect(result.totalDays).toBe(3);
        expect(result.yearBreakdown).toEqual([
          { year: 2026, days: 2 },
          { year: 2027, days: 1 },
        ]);
        expect(result.excludedDates).toEqual(
          expect.arrayContaining(['2027-01-01', '2027-01-02', '2027-01-03']),
        );

        expect(leaveBalanceRepo.reserveBalance).toHaveBeenCalledTimes(2);
        expect(leaveBalanceRepo.reserveBalance).toHaveBeenNthCalledWith(
          1,
          mockEmployee._id,
          leaveTypeId,
          2026,
          2,
          false,
          actorUserId,
          expect.anything(),
        );
        expect(leaveBalanceRepo.reserveBalance).toHaveBeenNthCalledWith(
          2,
          mockEmployee._id,
          leaveTypeId,
          2027,
          1,
          false,
          actorUserId,
          expect.anything(),
        );
      });

      it('Combination 2 (deductWeekends: true, deductHolidays: false): should deduct weekly offs but exclude holidays across both years', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          deductWeekends: true,
          deductHolidays: false,
          maxConsecutiveDays: 30,
        });

        const result = await service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-12-30',
          endDate: '2027-01-04',
          reason: 'Combination 2 multi-year vacation',
        });

        // 2026: Dec 30, 31 = 2 days
        // 2027: Jan 01 (hldy excluded), Jan 02 & 03 (wknd deducted), Jan 04 = 3 days
        // Total = 5 days
        expect(result.totalDays).toBe(5);
        expect(result.yearBreakdown).toEqual([
          { year: 2026, days: 2 },
          { year: 2027, days: 3 },
        ]);
        expect(result.excludedDates).toEqual(['2027-01-01']);

        expect(leaveBalanceRepo.reserveBalance).toHaveBeenCalledTimes(2);
        expect(leaveBalanceRepo.reserveBalance).toHaveBeenNthCalledWith(
          1,
          mockEmployee._id,
          leaveTypeId,
          2026,
          2,
          false,
          actorUserId,
          expect.anything(),
        );
        expect(leaveBalanceRepo.reserveBalance).toHaveBeenNthCalledWith(
          2,
          mockEmployee._id,
          leaveTypeId,
          2027,
          3,
          false,
          actorUserId,
          expect.anything(),
        );
      });

      it('Combination 3 (deductWeekends: false, deductHolidays: true): should exclude weekly offs but deduct holidays across both years', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          deductWeekends: false,
          deductHolidays: true,
          maxConsecutiveDays: 30,
        });

        const result = await service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-12-30',
          endDate: '2027-01-04',
          reason: 'Combination 3 multi-year vacation',
        });

        // 2026: Dec 30, 31 = 2 days
        // 2027: Jan 01 (hldy deducted), Jan 02 & 03 (wknd excluded), Jan 04 = 2 days
        // Total = 4 days
        expect(result.totalDays).toBe(4);
        expect(result.yearBreakdown).toEqual([
          { year: 2026, days: 2 },
          { year: 2027, days: 2 },
        ]);
        expect(result.excludedDates).toEqual(
          expect.arrayContaining(['2027-01-02', '2027-01-03']),
        );

        expect(leaveBalanceRepo.reserveBalance).toHaveBeenCalledTimes(2);
        expect(leaveBalanceRepo.reserveBalance).toHaveBeenNthCalledWith(
          1,
          mockEmployee._id,
          leaveTypeId,
          2026,
          2,
          false,
          actorUserId,
          expect.anything(),
        );
        expect(leaveBalanceRepo.reserveBalance).toHaveBeenNthCalledWith(
          2,
          mockEmployee._id,
          leaveTypeId,
          2027,
          2,
          false,
          actorUserId,
          expect.anything(),
        );
      });

      it('Combination 4 (deductWeekends: true, deductHolidays: true): should deduct both weekly offs and holidays across both years', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          deductWeekends: true,
          deductHolidays: true,
          maxConsecutiveDays: 30,
        });

        const result = await service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-12-30',
          endDate: '2027-01-04',
          reason: 'Combination 4 multi-year vacation',
        });

        // All 6 days deducted (2 in 2026, 4 in 2027)
        expect(result.totalDays).toBe(6);
        expect(result.yearBreakdown).toEqual([
          { year: 2026, days: 2 },
          { year: 2027, days: 4 },
        ]);
        expect(result.excludedDates).toHaveLength(0);

        expect(leaveBalanceRepo.reserveBalance).toHaveBeenCalledTimes(2);
        expect(leaveBalanceRepo.reserveBalance).toHaveBeenNthCalledWith(
          1,
          mockEmployee._id,
          leaveTypeId,
          2026,
          2,
          false,
          actorUserId,
          expect.anything(),
        );
        expect(leaveBalanceRepo.reserveBalance).toHaveBeenNthCalledWith(
          2,
          mockEmployee._id,
          leaveTypeId,
          2027,
          4,
          false,
          actorUserId,
          expect.anything(),
        );
      });

      it('Attendance Syncing on Approval: never marks ON_LEAVE on excluded holiday dates even when deductWeekends is true', async () => {
        // Leave request with deductWeekends: true and deductHolidays: false
        // Excluded date: 2027-01-01 (holiday)
        const mockRequestToApprove: LeaveRequestLean = {
          _id: requestId,
          employeeId: mockEmployee._id,
          leaveTypeId,
          leaveTypeSnapshot: {
            code: 'PL',
            name: 'Privilege Leave',
            isPaid: true,
            allowHalfDay: false,
            deductWeekends: true,
            deductHolidays: false,
          },
          startDate: '2026-12-30',
          endDate: '2027-01-04',
          totalDays: 5,
          isHalfDay: false,
          halfDaySession: null,
          yearBreakdown: [
            { year: 2026, days: 2 },
            { year: 2027, days: 3 },
          ],
          excludedDates: ['2027-01-01'], // Holiday excluded at application time
          reason: 'Vacation with weekend deduction',
          reportingManagerId: new Types.ObjectId(),
          status: LeaveRequestStatus.PENDING,
          approvalTimeline: [],
          appliedAt: new Date(),
          createdBy: actorUserId,
          updatedBy: null,
          deletedBy: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        employeeRepo.findByUserId.mockImplementation((uId) =>
          Promise.resolve(
            uId.toString() === managerUserId.toString()
              ? mockManager
              : mockEmployee,
          ),
        );
        leaveRequestRepo.findById.mockResolvedValue(mockRequestToApprove);
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveBalanceRepo.debitApprovedBalance.mockResolvedValue({
          ...mockBalance,
          usedDays: 5,
        });
        leaveRequestRepo.updateStatus.mockResolvedValue({
          ...mockRequestToApprove,
          status: LeaveRequestStatus.APPROVED,
        });

        await service.approveLeave(managerUserId, requestId, {
          remarks: 'Approved',
        });

        // 2027-01-01 was in excludedDates -> MUST NOT be synced as ON_LEAVE
        expect(attendanceRepo.syncLeaveAttendance).not.toHaveBeenCalledWith(
          expect.anything(),
          '2027-01-01',
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
        );

        // Working and weekly off days (since deductWeekends: true) MUST be synced
        expect(attendanceRepo.syncLeaveAttendance).toHaveBeenCalledWith(
          mockEmployee._id,
          '2026-12-30',
          expect.anything(),
          expect.anything(),
          expect.anything(),
          requestId,
          expect.anything(),
        );
        expect(attendanceRepo.syncLeaveAttendance).toHaveBeenCalledWith(
          mockEmployee._id,
          '2027-01-02',
          expect.anything(),
          expect.anything(),
          expect.anything(),
          requestId,
          expect.anything(),
        );
      });

      it('Overlapping Weekly Off and Holiday: deduplicates excludedDates on leave request when both coincide', async () => {
        // Coinciding date: Sunday 2026-10-25 is a weekly off AND a holiday
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          deductWeekends: false,
          deductHolidays: false,
        });

        const coincidingHoliday: HolidayLean = {
          ...mockMultiYearHoliday,
          date: '2026-10-25',
          year: 2026,
        };
        holidayRepo.findApplicableHolidays.mockResolvedValue([
          coincidingHoliday,
        ]);
        weeklyOffService.getWeeklyOffDatesForRange.mockResolvedValue(
          new Set(['2026-10-24', '2026-10-25']),
        );

        let createdPayload: Partial<LeaveRequestLean> | undefined;
        leaveRequestRepo.create.mockImplementation((payload) => {
          createdPayload = payload;
          return Promise.resolve({
            _id: requestId,
            ...payload,
          } as unknown as LeaveRequestLean);
        });

        const result = await service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-10-23',
          endDate: '2026-10-26',
          reason: 'Overlapping weekend and holiday vacation',
        });

        // Total deductible days: Fri Oct 23 & Mon Oct 26 = 2 days
        expect(result.totalDays).toBe(2);
        // Excluded dates: Sat 24, Sun 25 (without any duplicate '2026-10-25')
        expect(createdPayload?.excludedDates).toEqual([
          '2026-10-24',
          '2026-10-25',
        ]);
        expect(
          createdPayload?.excludedDates?.filter(
            (d: string) => d === '2026-10-25',
          ),
        ).toHaveLength(1);
      });

      it('Legacy Request Safety: safely debits balance using startDate when yearBreakdown is missing/empty on approval', async () => {
        const legacyRequest: LeaveRequestLean = {
          _id: requestId,
          employeeId: mockEmployee._id,
          leaveTypeId,
          leaveTypeSnapshot: {
            code: 'CL',
            name: 'Casual Leave',
            isPaid: true,
            allowHalfDay: true,
            deductWeekends: false,
            deductHolidays: false,
          },
          startDate: '2026-05-11',
          endDate: '2026-05-12',
          totalDays: 2,
          isHalfDay: false,
          halfDaySession: null,
          yearBreakdown: [], // Legacy empty breakdown
          excludedDates: [],
          reason: 'Legacy request approval',
          reportingManagerId: new Types.ObjectId(),
          status: LeaveRequestStatus.PENDING,
          approvalTimeline: [],
          appliedAt: new Date(),
          createdBy: actorUserId,
          updatedBy: null,
          deletedBy: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        employeeRepo.findByUserId.mockImplementation((uId) =>
          Promise.resolve(
            uId.toString() === managerUserId.toString()
              ? mockManager
              : mockEmployee,
          ),
        );
        leaveRequestRepo.findById.mockResolvedValue(legacyRequest);
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveBalanceRepo.debitApprovedBalance.mockResolvedValue({
          ...mockBalance,
          usedDays: 2,
        });
        leaveRequestRepo.updateStatus.mockResolvedValue({
          ...legacyRequest,
          status: LeaveRequestStatus.APPROVED,
        });

        await service.approveLeave(managerUserId, requestId, {
          remarks: 'Approved legacy request',
        });

        expect(leaveBalanceRepo.debitApprovedBalance).toHaveBeenCalledWith(
          mockEmployee._id,
          leaveTypeId,
          2026,
          2,
          managerUserId,
          expect.anything(),
        );
      });

      it('Legacy Request Safety: safely releases reservation using startDate when yearBreakdown is missing/empty on rejection', async () => {
        const legacyRequest: LeaveRequestLean = {
          _id: requestId,
          employeeId: mockEmployee._id,
          leaveTypeId,
          leaveTypeSnapshot: {
            code: 'CL',
            name: 'Casual Leave',
            isPaid: true,
            allowHalfDay: true,
            deductWeekends: false,
            deductHolidays: false,
          },
          startDate: '2026-05-11',
          endDate: '2026-05-12',
          totalDays: 2,
          isHalfDay: false,
          halfDaySession: null,
          yearBreakdown: [],
          excludedDates: [],
          reason: 'Legacy request rejection',
          reportingManagerId: new Types.ObjectId(),
          status: LeaveRequestStatus.PENDING,
          approvalTimeline: [],
          appliedAt: new Date(),
          createdBy: actorUserId,
          updatedBy: null,
          deletedBy: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        employeeRepo.findByUserId.mockImplementation((uId) =>
          Promise.resolve(
            uId.toString() === managerUserId.toString()
              ? mockManager
              : mockEmployee,
          ),
        );
        leaveRequestRepo.findById.mockResolvedValue(legacyRequest);
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveBalanceRepo.releaseReservation.mockResolvedValue({
          ...mockBalance,
          pendingDays: 0,
        });
        leaveRequestRepo.updateStatus.mockResolvedValue({
          ...legacyRequest,
          status: LeaveRequestStatus.REJECTED,
        });

        await service.rejectLeave(managerUserId, requestId, {
          reason: 'Rejected legacy request',
        });

        expect(leaveBalanceRepo.releaseReservation).toHaveBeenCalledWith(
          mockEmployee._id,
          leaveTypeId,
          2026,
          2,
          managerUserId,
          expect.anything(),
        );
      });
    });

    describe('Half-Day and Session Handling (Strict Production Rules)', () => {
      beforeEach(() => {
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
        holidayRepo.findApplicableHolidays.mockResolvedValue([]);
        leaveRequestRepo.findOverlappingRequests.mockResolvedValue([]);
        leaveBalanceRepo.reserveBalance.mockResolvedValue(mockBalance);
        leaveRequestRepo.create.mockImplementation((dto) =>
          Promise.resolve({
            _id: requestId,
            ...dto,
            status: LeaveRequestStatus.PENDING,
          } as unknown as LeaveRequestLean),
        );
      });

      it('should reject when isHalfDay is true but halfDaySession is missing', async () => {
        await expect(
          service.applyLeave(actorUserId, {
            leaveTypeId: leaveTypeId.toString(),
            startDate: '2026-12-28',
            endDate: '2026-12-28',
            isHalfDay: true,
            reason: 'Doctor consultation morning',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Half-day session is required for half-day leave',
            HttpStatus.BAD_REQUEST,
          ),
        );
      });

      it('should reject when isHalfDay is true but halfDaySession is null', async () => {
        await expect(
          service.applyLeave(actorUserId, {
            leaveTypeId: leaveTypeId.toString(),
            startDate: '2026-12-28',
            endDate: '2026-12-28',
            isHalfDay: true,
            halfDaySession: null,
            reason: 'Doctor consultation morning',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Half-day session is required for half-day leave',
            HttpStatus.BAD_REQUEST,
          ),
        );
      });

      it('should reject when isHalfDay is false and halfDaySession is FIRST_HALF', async () => {
        await expect(
          service.applyLeave(actorUserId, {
            leaveTypeId: leaveTypeId.toString(),
            startDate: '2026-12-28',
            endDate: '2026-12-28',
            isHalfDay: false,
            halfDaySession: HalfDaySession.FIRST_HALF,
            reason: 'Personal errand work',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'halfDaySession must not be provided when isHalfDay is false',
            HttpStatus.BAD_REQUEST,
          ),
        );
      });

      it('should reject when isHalfDay is false and halfDaySession is SECOND_HALF', async () => {
        await expect(
          service.applyLeave(actorUserId, {
            leaveTypeId: leaveTypeId.toString(),
            startDate: '2026-12-28',
            endDate: '2026-12-28',
            isHalfDay: false,
            halfDaySession: HalfDaySession.SECOND_HALF,
            reason: 'Personal errand work',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'halfDaySession must not be provided when isHalfDay is false',
            HttpStatus.BAD_REQUEST,
          ),
        );
      });

      it('should reject when isHalfDay is omitted and halfDaySession is provided', async () => {
        await expect(
          service.applyLeave(actorUserId, {
            leaveTypeId: leaveTypeId.toString(),
            startDate: '2026-12-28',
            endDate: '2026-12-28',
            halfDaySession: HalfDaySession.FIRST_HALF,
            reason: 'Personal errand work',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'halfDaySession must not be provided when isHalfDay is false',
            HttpStatus.BAD_REQUEST,
          ),
        );
      });

      it('should reject when isHalfDay is true and halfDaySession is an invalid enum', async () => {
        await expect(
          service.applyLeave(actorUserId, {
            leaveTypeId: leaveTypeId.toString(),
            startDate: '2026-12-28',
            endDate: '2026-12-28',
            isHalfDay: true,
            halfDaySession: 'INVALID_SESSION' as unknown as HalfDaySession,
            reason: 'Personal errand work',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'halfDaySession must be either FIRST_HALF or SECOND_HALF',
            HttpStatus.BAD_REQUEST,
          ),
        );
      });

      it('should strictly accept isHalfDay: false with same start and end date as 1 full day', async () => {
        const result = await service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-12-28',
          endDate: '2026-12-28',
          isHalfDay: false,
          reason: 'Full day single-day leave',
        });

        expect(result).toBeDefined();
        expect(leaveBalanceRepo.reserveBalance).toHaveBeenCalledWith(
          employeeId,
          leaveTypeId,
          2026,
          1, // Full 1.0 day
          false,
          actorUserId,
          expect.anything(),
        );
        expect(leaveRequestRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            totalDays: 1,
            isHalfDay: false,
            halfDaySession: null,
          }),
          expect.anything(),
        );
      });

      it('should strictly accept isHalfDay: false with halfDaySession: null as 1 full day', async () => {
        const result = await service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-12-28',
          endDate: '2026-12-28',
          isHalfDay: false,
          halfDaySession: null,
          reason: 'Full day leave with null session',
        });

        expect(result).toBeDefined();
        expect(leaveBalanceRepo.reserveBalance).toHaveBeenCalledWith(
          employeeId,
          leaveTypeId,
          2026,
          1,
          false,
          actorUserId,
          expect.anything(),
        );
        expect(leaveRequestRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            totalDays: 1,
            isHalfDay: false,
            halfDaySession: null,
          }),
          expect.anything(),
        );
      });

      it('should accept isHalfDay: true and halfDaySession: FIRST_HALF as exactly 0.5 day', async () => {
        const result = await service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-12-28',
          endDate: '2026-12-28',
          isHalfDay: true,
          halfDaySession: HalfDaySession.FIRST_HALF,
          reason: 'Attending morning dental appointment',
        });

        expect(result).toBeDefined();
        expect(leaveBalanceRepo.reserveBalance).toHaveBeenCalledWith(
          employeeId,
          leaveTypeId,
          2026,
          0.5, // Exactly 0.5 day
          false,
          actorUserId,
          expect.anything(),
        );
        expect(leaveRequestRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            totalDays: 0.5,
            isHalfDay: true,
            halfDaySession: HalfDaySession.FIRST_HALF,
          }),
          expect.anything(),
        );
      });

      it('should accept isHalfDay: true and halfDaySession: SECOND_HALF as exactly 0.5 day', async () => {
        const result = await service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-12-28',
          endDate: '2026-12-28',
          isHalfDay: true,
          halfDaySession: HalfDaySession.SECOND_HALF,
          reason: 'Attending afternoon dental appointment',
        });

        expect(result).toBeDefined();
        expect(leaveBalanceRepo.reserveBalance).toHaveBeenCalledWith(
          employeeId,
          leaveTypeId,
          2026,
          0.5,
          false,
          actorUserId,
          expect.anything(),
        );
        expect(leaveRequestRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            totalDays: 0.5,
            isHalfDay: true,
            halfDaySession: HalfDaySession.SECOND_HALF,
          }),
          expect.anything(),
        );
      });

      it('should reject isHalfDay: true when startDate does not equal endDate', async () => {
        await expect(
          service.applyLeave(actorUserId, {
            leaveTypeId: leaveTypeId.toString(),
            startDate: '2026-12-28',
            endDate: '2026-12-29',
            isHalfDay: true,
            halfDaySession: HalfDaySession.FIRST_HALF,
            reason: 'Invalid multi-day half-day request',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Half-day leave must start and end on the exact same date',
            HttpStatus.BAD_REQUEST,
          ),
        );
      });

      it('should reject isHalfDay: true when leave type does not allow half-day leave', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          allowHalfDay: false,
        });

        await expect(
          service.applyLeave(actorUserId, {
            leaveTypeId: leaveTypeId.toString(),
            startDate: '2026-12-28',
            endDate: '2026-12-28',
            isHalfDay: true,
            halfDaySession: HalfDaySession.FIRST_HALF,
            reason: 'Half-day on restricted leave type',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Half-day leave is not permitted for this leave type',
            HttpStatus.BAD_REQUEST,
          ),
        );
      });

      it('Test 7: should reject when leave type requiresAttachment: true and attachmentUrl is missing', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          name: 'Sick Leave',
          requiresAttachment: true,
        });

        await expect(
          service.applyLeave(actorUserId, {
            leaveTypeId: leaveTypeId.toString(),
            startDate: '2026-12-28',
            endDate: '2026-12-28',
            isHalfDay: false,
            reason: 'Medical consultation without certificate',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            "Supporting attachment is required for 'Sick Leave'",
            HttpStatus.BAD_REQUEST,
          ),
        );
      });

      it('Test 7: should accept when leave type requiresAttachment: true and attachmentUrl is valid', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          name: 'Sick Leave',
          requiresAttachment: true,
        });

        const result = await service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-12-28',
          endDate: '2026-12-28',
          isHalfDay: false,
          reason: 'Medical consultation with prescription attached',
          attachmentUrl:
            'https://storage.enterprise.com/docs/medical_cert_01.pdf',
        });

        expect(result).toBeDefined();
        expect(leaveRequestRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            attachmentUrl:
              'https://storage.enterprise.com/docs/medical_cert_01.pdf',
          }),
          expect.anything(),
        );
      });
    });
  });

  // ===========================================================================
  // 2. NEGATIVE LEAVE BALANCES (DECISION 2)
  // ===========================================================================

  describe('Decision 2: Negative Leave Balance Control', () => {
    it('should reject application when available balance is insufficient and allowNegativeBalance is false', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        allowNegativeBalance: false,
      });

      // Atomic reservation returns null when availableBalance < requested days
      leaveBalanceRepo.reserveBalance.mockResolvedValue(null);

      await expect(
        service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-05-11',
          endDate: '2026-05-15', // 5 days
          reason: 'Annual trip',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Insufficient leave balance for year 2026. Requested: 5 days',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 15a: should reject manual debit adjustment when debit exceeds available balance and allowNegativeBalance is false', async () => {
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        allowNegativeBalance: false,
      });
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        availableBalance: 2,
      });
      // manualAdjust returns null if availableBalance < days
      leaveBalanceRepo.manualAdjust.mockResolvedValue(null);

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'DEBIT',
          days: 5,
          reason: 'Excessive debit adjustment',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Insufficient available balance to perform manual debit adjustment',
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 15b: should allow manual debit adjustment exceeding available balance when leave type allows negative balance (allowNegativeBalance: true)', async () => {
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        allowNegativeBalance: true,
      });
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        availableBalance: 5,
      });
      const updatedBalance: LeaveBalanceLean = {
        ...mockBalance,
        debitedDays: 10,
        availableBalance: -5,
      };
      leaveBalanceRepo.manualAdjust.mockResolvedValue(updatedBalance);
      const mockTx: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.MANUAL_DEBIT,
        days: -10,
        previousAvailable: 5,
        newAvailable: -5,
        referenceId: null,
        referenceType: 'ManualAdjustment',
        remarks: 'Testing debit exceeding available balance.',
        actorId: actorUserId,
        createdAt: new Date(),
      };
      leaveTransactionRepo.create.mockResolvedValue(mockTx);

      const result = await service.adjustBalance(actorUserId, {
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
        year: 2026,
        adjustmentType: 'DEBIT',
        days: 10,
        reason: 'Testing debit exceeding available balance.',
      });

      expect(result.availableBalance).toBe(-5);
      expect(leaveBalanceRepo.manualAdjust).toHaveBeenCalledWith(
        employeeId,
        leaveTypeId,
        2026,
        'DEBIT',
        10,
        actorUserId,
        true,
        expect.anything(),
      );
      expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: LeaveTransactionType.MANUAL_DEBIT,
          days: -10,
          previousAvailable: 5,
          newAvailable: -5,
        }),
        expect.anything(),
      );
    });

    it('should throw 404 Not Found when target employee does not exist on adjustBalance', async () => {
      employeeRepo.findById.mockResolvedValue(null);

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'DEBIT',
          days: 1,
          reason: 'Adjust non-existent employee',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Employee not found',
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('Test 10: should throw 404 Not Found when employee is soft-deleted and prevent balance/transaction creation', async () => {
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        deletedAt: new Date(),
      });

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'DEBIT',
          days: 1,
          reason: 'Adjust soft-deleted employee',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Employee not found',
          HttpStatus.NOT_FOUND,
        ),
      );

      expect(leaveBalanceRepo.manualAdjust).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 11a: should reject balance adjustment for terminated employee with 403 Forbidden', async () => {
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: EmploymentStatus.TERMINATED,
      });

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'CREDIT',
          days: 1,
          reason: 'Adjust terminated employee balance',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          "Cannot adjust leave balance for employee with status 'terminated'",
          HttpStatus.FORBIDDEN,
        ),
      );

      expect(leaveBalanceRepo.manualAdjust).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 11b: should reject balance adjustment for resigned employee with 403 Forbidden', async () => {
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: EmploymentStatus.RESIGNED,
      });

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'CREDIT',
          days: 1,
          reason: 'Adjust resigned employee balance',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          "Cannot adjust leave balance for employee with status 'resigned'",
          HttpStatus.FORBIDDEN,
        ),
      );

      expect(leaveBalanceRepo.manualAdjust).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 11c: should permit balance adjustment for probation employee if eligible on leave type', async () => {
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: EmploymentStatus.PROBATION,
      });
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        applicableEmploymentStatuses: [
          EmploymentStatus.ACTIVE,
          EmploymentStatus.PROBATION,
        ],
      });
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(mockBalance);
      leaveBalanceRepo.manualAdjust.mockResolvedValue({
        ...mockBalance,
        creditedDays: 2,
        availableBalance: 14,
      });
      const mockTx: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.MANUAL_CREDIT,
        days: 2,
        previousAvailable: 12,
        newAvailable: 14,
        referenceId: null,
        referenceType: 'ManualAdjustment',
        remarks: 'Adjust probation employee balance',
        actorId: actorUserId,
        createdAt: new Date(),
      };
      leaveTransactionRepo.create.mockResolvedValue(mockTx);

      const result = await service.adjustBalance(actorUserId, {
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
        year: 2026,
        adjustmentType: 'CREDIT',
        days: 2,
        reason: 'Adjust probation employee balance',
      });

      expect(result).toBeDefined();
      expect(leaveBalanceRepo.manualAdjust).toHaveBeenCalled();
      expect(leaveTransactionRepo.create).toHaveBeenCalled();
    });

    it('Test 11d: should permit balance adjustment for notice period employee if eligible on leave type', async () => {
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: EmploymentStatus.NOTICE_PERIOD,
      });
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        applicableEmploymentStatuses: [
          EmploymentStatus.ACTIVE,
          EmploymentStatus.PROBATION,
          EmploymentStatus.NOTICE_PERIOD,
        ],
      });
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(mockBalance);
      leaveBalanceRepo.manualAdjust.mockResolvedValue({
        ...mockBalance,
        creditedDays: 1,
        availableBalance: 13,
      });
      const mockTx: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.MANUAL_CREDIT,
        days: 2,
        previousAvailable: 12,
        newAvailable: 14,
        referenceId: null,
        referenceType: 'ManualAdjustment',
        remarks: 'Adjust probation employee balance',
        actorId: actorUserId,
        createdAt: new Date(),
      };
      leaveTransactionRepo.create.mockResolvedValue(mockTx);

      const result = await service.adjustBalance(actorUserId, {
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
        year: 2026,
        adjustmentType: 'CREDIT',
        days: 1,
        reason: 'Adjust notice period employee balance',
      });

      expect(result).toBeDefined();
      expect(leaveBalanceRepo.manualAdjust).toHaveBeenCalled();
      expect(leaveTransactionRepo.create).toHaveBeenCalled();
    });

    it('Test 11e: should reject balance adjustment if employee status is excluded by leave type applicable statuses', async () => {
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: EmploymentStatus.PROBATION,
      });
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        applicableEmploymentStatuses: [EmploymentStatus.ACTIVE],
      });

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'CREDIT',
          days: 1,
          reason: 'Adjust probationary employee for full-time only leave type',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          `Employees on 'probation' are not eligible for '${mockLeaveType.name}'`,
          HttpStatus.FORBIDDEN,
        ),
      );

      expect(leaveBalanceRepo.manualAdjust).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 14: should reject balance adjustment for inactive leave type with 400 Bad Request', async () => {
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        isActive: false,
      });

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'CREDIT',
          days: 1,
          reason: 'Adjust balance for inactive leave type',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Cannot adjust balance for inactive leave type '${mockLeaveType.name}'`,
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveBalanceRepo.findByEmployeeTypeYear).not.toHaveBeenCalled();
      expect(leaveBalanceRepo.manualAdjust).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 16: should throw 404 Not Found when leave balance does not exist for employee and year on adjustBalance', async () => {
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'DEBIT',
          days: 1,
          reason: 'Adjust non-existent balance',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Leave balance not found for employee for leave type '${mockLeaveType.name}' in year 2026`,
          HttpStatus.NOT_FOUND,
        ),
      );

      expect(leaveBalanceRepo.manualAdjust).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 17: should allow debit adjustment exactly equal to available balance resulting in zero balance', async () => {
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        allowNegativeBalance: false,
      });
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        availableBalance: 5,
      });
      const updatedBalance: LeaveBalanceLean = {
        ...mockBalance,
        debitedDays: 5,
        availableBalance: 0,
      };
      leaveBalanceRepo.manualAdjust.mockResolvedValue(updatedBalance);
      const mockTx: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.MANUAL_DEBIT,
        days: -5,
        previousAvailable: 5,
        newAvailable: 0,
        referenceId: null,
        referenceType: 'ManualAdjustment',
        remarks: 'Correcting balance.',
        actorId: actorUserId,
        createdAt: new Date(),
      };
      leaveTransactionRepo.create.mockResolvedValue(mockTx);

      const result = await service.adjustBalance(actorUserId, {
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
        year: 2026,
        adjustmentType: 'DEBIT',
        days: 5,
        reason: 'Correcting balance.',
      });

      expect(result.availableBalance).toBe(0);
      expect(leaveBalanceRepo.manualAdjust).toHaveBeenCalledWith(
        employeeId,
        leaveTypeId,
        2026,
        'DEBIT',
        5,
        actorUserId,
        false,
        expect.anything(),
      );
      expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: LeaveTransactionType.MANUAL_DEBIT,
          days: -5,
          previousAvailable: 5,
          newAvailable: 0,
          remarks: 'Correcting balance.',
        }),
        expect.anything(),
      );
    });

    it('Test 18: should reject adjustment with invalid year at domain level', async () => {
      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 0,
          adjustmentType: 'CREDIT',
          days: 1,
          reason: 'Testing invalid year.',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Year must be a valid integer between 2000 and 2100',
          HttpStatus.BAD_REQUEST,
        ),
      );

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 1999,
          adjustmentType: 'CREDIT',
          days: 1,
          reason: 'Testing year 1999.',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Year must be a valid integer between 2000 and 2100',
          HttpStatus.BAD_REQUEST,
        ),
      );

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2101,
          adjustmentType: 'CREDIT',
          days: 1,
          reason: 'Testing year 2101.',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Year must be a valid integer between 2000 and 2100',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 19/20: should reject adjustment with missing, empty, or whitespace-only reason at domain level', async () => {
      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'CREDIT',
          days: 1,
          reason: '',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Adjustment reason is required and must contain at least 5 characters',
          HttpStatus.BAD_REQUEST,
        ),
      );

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'CREDIT',
          days: 1,
          reason: '     ',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Adjustment reason is required and must contain at least 5 characters',
          HttpStatus.BAD_REQUEST,
        ),
      );

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'CREDIT',
          days: 1,
          reason: 'abc',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Adjustment reason is required and must contain at least 5 characters',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 22/23: should record actorId, audit log, and full transaction details in ledger for Superadmin/HR adjustment', async () => {
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        availableBalance: 15,
      });
      const updatedBalance: LeaveBalanceLean = {
        ...mockBalance,
        creditedDays: 1.5,
        availableBalance: 16.5,
      };
      leaveBalanceRepo.manualAdjust.mockResolvedValue(updatedBalance);
      const mockTx: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.MANUAL_CREDIT,
        days: 1.5,
        previousAvailable: 15,
        newAvailable: 16.5,
        referenceId: null,
        referenceType: 'ManualAdjustment',
        remarks:
          'Correction for overtime worked during branch system migration.',
        actorId: actorUserId,
        createdAt: new Date(),
      };
      leaveTransactionRepo.create.mockResolvedValue(mockTx);

      const result = await service.adjustBalance(
        actorUserId,
        {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'CREDIT',
          days: 1.5,
          reason:
            'Correction for overtime worked during branch system migration.',
        },
        { ipAddress: '192.168.1.1', userAgent: 'Chrome/Test' },
      );

      expect(result.availableBalance).toBe(16.5);
      expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId,
          leaveTypeId,
          year: 2026,
          transactionType: LeaveTransactionType.MANUAL_CREDIT,
          days: 1.5,
          previousAvailable: 15,
          newAvailable: 16.5,
          remarks:
            'Correction for overtime worked during branch system migration.',
          actorId: actorUserId,
        }),
        expect.anything(),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: actorUserId,
          action: AuditAction.LEAVE_BALANCE_ADJUSTED,
          details: {
            adjustmentType: 'CREDIT',
            days: 1.5,
            reason:
              'Correction for overtime worked during branch system migration.',
          },
        }),
        expect.anything(),
      );
    });

    it('Test 24: should abort and roll back balance adjustment if ledger transaction write fails', async () => {
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        availableBalance: 10,
      });
      leaveBalanceRepo.manualAdjust.mockResolvedValue({
        ...mockBalance,
        creditedDays: 2,
        availableBalance: 12,
      });
      leaveTransactionRepo.create.mockRejectedValue(
        new Error('MongoNetworkTimeoutException during ledger insert'),
      );

      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'CREDIT',
          days: 2,
          reason: 'Testing transaction failure rollback',
        }),
      ).rejects.toThrow('MongoNetworkTimeoutException during ledger insert');

      expect(leaveTransactionRepo.create).toHaveBeenCalled();
    });

    it('Test 25: should record distinct ledger transactions when duplicate adjustment requests are submitted', async () => {
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        availableBalance: 10,
      });
      leaveBalanceRepo.manualAdjust
        .mockResolvedValueOnce({
          ...mockBalance,
          creditedDays: 1,
          availableBalance: 11,
        })
        .mockResolvedValueOnce({
          ...mockBalance,
          creditedDays: 2,
          availableBalance: 12,
        });

      const tx1: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.MANUAL_CREDIT,
        days: 1,
        previousAvailable: 10,
        newAvailable: 11,
        referenceId: null,
        referenceType: 'ManualAdjustment',
        remarks: 'Duplicate request test.',
        actorId: actorUserId,
        createdAt: new Date(),
      };
      const tx2: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.MANUAL_CREDIT,
        days: 1,
        previousAvailable: 11,
        newAvailable: 12,
        referenceId: null,
        referenceType: 'ManualAdjustment',
        remarks: 'Duplicate request test.',
        actorId: actorUserId,
        createdAt: new Date(),
      };
      leaveTransactionRepo.create
        .mockResolvedValueOnce(tx1)
        .mockResolvedValueOnce(tx2);

      const payload = {
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
        year: 2026,
        adjustmentType: 'CREDIT' as const,
        days: 1,
        reason: 'Duplicate request test.',
      };

      const res1 = await service.adjustBalance(actorUserId, payload);
      const res2 = await service.adjustBalance(actorUserId, payload);

      expect(res1.availableBalance).toBe(11);
      expect(res2.availableBalance).toBe(12);
      expect(leaveTransactionRepo.create).toHaveBeenCalledTimes(2);
    });

    it('Test 26: should atomically process concurrent adjustments with MongoDB $inc semantics', async () => {
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        availableBalance: 10,
      });

      leaveBalanceRepo.manualAdjust
        .mockResolvedValueOnce({
          ...mockBalance,
          creditedDays: 2,
          availableBalance: 12,
        })
        .mockResolvedValueOnce({
          ...mockBalance,
          debitedDays: 1,
          availableBalance: 11,
        });

      const txA: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.MANUAL_CREDIT,
        days: 2,
        previousAvailable: 10,
        newAvailable: 12,
        referenceId: null,
        referenceType: 'ManualAdjustment',
        remarks: 'Concurrent request A',
        actorId: actorUserId,
        createdAt: new Date(),
      };
      const txB: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.MANUAL_DEBIT,
        days: -1,
        previousAvailable: 12,
        newAvailable: 11,
        referenceId: null,
        referenceType: 'ManualAdjustment',
        remarks: 'Concurrent request B',
        actorId: actorUserId,
        createdAt: new Date(),
      };
      leaveTransactionRepo.create
        .mockResolvedValueOnce(txA)
        .mockResolvedValueOnce(txB);

      const [resA, resB] = await Promise.all([
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'CREDIT',
          days: 2,
          reason: 'Concurrent request A',
        }),
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'DEBIT',
          days: 1,
          reason: 'Concurrent request B',
        }),
      ]);

      expect(resA.availableBalance).toBe(12);
      expect(resB.availableBalance).toBe(11);
      expect(leaveBalanceRepo.manualAdjust).toHaveBeenCalledTimes(2);
      expect(leaveTransactionRepo.create).toHaveBeenCalledTimes(2);
    });

    it('Test 6: should reject manual adjustment when days has excessive decimal precision (> 2 decimal places)', async () => {
      await expect(
        service.adjustBalance(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          adjustmentType: 'CREDIT',
          days: 1.234567,
          reason: 'Testing excessive decimal precision.',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Adjustment days cannot exceed 2 decimal places of precision',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should allow manual credit adjustment and record audit transaction ledger', async () => {
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        availableBalance: 5,
      });
      const updatedBalance: LeaveBalanceLean = {
        ...mockBalance,
        creditedDays: 3,
        availableBalance: 8,
      };
      leaveBalanceRepo.manualAdjust.mockResolvedValue(updatedBalance);
      const mockTx: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.MANUAL_CREDIT,
        days: 3,
        previousAvailable: 5,
        newAvailable: 8,
        referenceId: null,
        referenceType: 'ManualAdjustment',
        remarks: 'Special authorized credit by HR',
        actorId: actorUserId,
        createdAt: new Date(),
      };
      leaveTransactionRepo.create.mockResolvedValue(mockTx);

      const result = await service.adjustBalance(actorUserId, {
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
        year: 2026,
        adjustmentType: 'CREDIT',
        days: 3,
        reason: 'Special authorized credit by HR',
      });

      expect(result.availableBalance).toBe(8);
      expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: LeaveTransactionType.MANUAL_CREDIT,
          days: 3,
          previousAvailable: 5,
          newAvailable: 8,
          remarks: 'Special authorized credit by HR',
        }),
        expect.anything(),
      );
    });
  });

  // ===========================================================================
  // 3. YEAR BOUNDARY CROSSOVER (DECISION 3)
  // ===========================================================================

  describe('Decision 3: Multi-Year Boundary Crossover Deductions', () => {
    it('should split days and atomically reserve balance per calendar year', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);

      // Dec 30, 2026 (Wed) - Jan 02, 2027 (Sat)
      // 2026: Dec 30, Dec 31 (2 days)
      // 2027: Jan 01, Jan 02 (2 days)
      leaveBalanceRepo.reserveBalance
        .mockResolvedValueOnce({
          ...mockBalance,
          year: 2026,
          pendingDays: 2,
          availableBalance: 10,
        })
        .mockResolvedValueOnce({
          ...mockBalance,
          year: 2027,
          pendingDays: 2,
          availableBalance: 10,
        });

      leaveRequestRepo.create.mockImplementation((payload) =>
        Promise.resolve({
          _id: requestId,
          ...payload,
        } as unknown as LeaveRequestLean),
      );

      const result = await service.applyLeave(actorUserId, {
        leaveTypeId: leaveTypeId.toString(),
        startDate: '2026-12-30',
        endDate: '2027-01-02',
        reason: 'New Year Vacation',
      });

      expect(result.yearBreakdown).toHaveLength(2);
      expect(result.yearBreakdown).toEqual([
        { year: 2026, days: 2 },
        { year: 2027, days: 2 },
      ]);
      expect(leaveBalanceRepo.reserveBalance).toHaveBeenCalledTimes(2);
      expect(leaveBalanceRepo.reserveBalance).toHaveBeenNthCalledWith(
        1,
        mockEmployee._id,
        leaveTypeId,
        2026,
        2,
        false,
        actorUserId,
        expect.anything(),
      );
      expect(leaveBalanceRepo.reserveBalance).toHaveBeenNthCalledWith(
        2,
        mockEmployee._id,
        leaveTypeId,
        2027,
        2,
        false,
        actorUserId,
        expect.anything(),
      );
    });

    it('should debit both years independently upon approval with transaction ledgers', async () => {
      const multiYearRequest: LeaveRequestLean = {
        _id: requestId,
        employeeId: mockEmployee._id,
        leaveTypeId,
        startDate: '2026-12-30',
        endDate: '2027-01-02',
        totalDays: 4,
        isHalfDay: false,
        halfDaySession: null,
        yearBreakdown: [
          { year: 2026, days: 2 },
          { year: 2027, days: 2 },
        ],
        status: LeaveRequestStatus.PENDING,
        leaveTypeSnapshot: {
          code: 'CL',
          name: 'Casual Leave',
          isPaid: true,
          deductWeekends: false,
          deductHolidays: false,
        },
      } as unknown as LeaveRequestLean;

      leaveRequestRepo.findById.mockResolvedValue(multiYearRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockManager);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveRequestRepo.updateStatus.mockResolvedValue({
        ...multiYearRequest,
        status: LeaveRequestStatus.APPROVED,
      });
      leaveBalanceRepo.debitApprovedBalance
        .mockResolvedValueOnce({
          ...mockBalance,
          year: 2026,
          usedDays: 2,
          availableBalance: 10,
        })
        .mockResolvedValueOnce({
          ...mockBalance,
          year: 2027,
          usedDays: 2,
          availableBalance: 10,
        });

      const approved = await service.approveLeave(managerUserId, requestId, {
        remarks: 'Approved for both years',
      });

      expect(approved.status).toBe(LeaveRequestStatus.APPROVED);
      expect(leaveBalanceRepo.debitApprovedBalance).toHaveBeenCalledTimes(2);
      expect(leaveBalanceRepo.debitApprovedBalance).toHaveBeenNthCalledWith(
        1,
        mockEmployee._id,
        leaveTypeId,
        2026,
        2,
        managerUserId,
        expect.anything(),
      );
      expect(leaveBalanceRepo.debitApprovedBalance).toHaveBeenNthCalledWith(
        2,
        mockEmployee._id,
        leaveTypeId,
        2027,
        2,
        managerUserId,
        expect.anything(),
      );
      expect(leaveTransactionRepo.create).toHaveBeenCalledTimes(2);
      expect(shiftService.resolveShift).toHaveBeenCalledWith(
        mockEmployee.shiftId,
        null,
        { employeeId: mockEmployee._id },
      );
      expect(attendanceRepo.syncLeaveAttendance).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 4. TIERED CANCELLATION POLICY (DECISION 4)
  // ===========================================================================

  describe('Decision 4: Three-Tiered Cancellation Policy', () => {
    it('Tier 1: should cancel PENDING leave and immediately release reservation', async () => {
      const pendingRequest: LeaveRequestLean = {
        _id: requestId,
        employeeId: mockEmployee._id,
        leaveTypeId,
        startDate: '2026-07-10',
        endDate: '2026-07-11',
        totalDays: 2,
        yearBreakdown: [{ year: 2026, days: 2 }],
        status: LeaveRequestStatus.PENDING,
      } as unknown as LeaveRequestLean;

      leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveRequestRepo.updateStatus.mockResolvedValue({
        ...pendingRequest,
        status: LeaveRequestStatus.CANCELLED,
      });
      leaveBalanceRepo.releaseReservation.mockResolvedValue({
        ...mockBalance,
        pendingDays: 0,
        availableBalance: 12,
      });

      const result = await service.cancelLeave(actorUserId, requestId, {
        reason: 'Change of travel plans',
      });

      expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
      expect(leaveBalanceRepo.releaseReservation).toHaveBeenCalledWith(
        mockEmployee._id,
        leaveTypeId,
        2026,
        2,
        actorUserId,
        expect.anything(),
      );
      expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: LeaveTransactionType.RESERVATION_RELEASE,
          days: 2,
        }),
        expect.anything(),
      );
    });

    it('Tier 2: should cancel future APPROVED leave, restore balance, and remove future attendance', async () => {
      // Future dates in 2099 so it is guaranteed > today
      const futureApprovedRequest: LeaveRequestLean = {
        _id: requestId,
        employeeId: mockEmployee._id,
        leaveTypeId,
        startDate: '2099-10-01',
        endDate: '2099-10-02',
        totalDays: 2,
        yearBreakdown: [{ year: 2099, days: 2 }],
        status: LeaveRequestStatus.APPROVED,
      } as unknown as LeaveRequestLean;

      leaveRequestRepo.findById.mockResolvedValue(futureApprovedRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveRequestRepo.updateStatus.mockResolvedValue({
        ...futureApprovedRequest,
        status: LeaveRequestStatus.CANCELLED,
      });
      leaveBalanceRepo.creditCancelledBalance.mockResolvedValue({
        ...mockBalance,
        year: 2099,
        usedDays: 0,
        availableBalance: 12,
      });

      const result = await service.cancelLeave(actorUserId, requestId, {
        reason: 'Future holiday cancelled',
      });

      expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
      expect(leaveBalanceRepo.creditCancelledBalance).toHaveBeenCalledWith(
        mockEmployee._id,
        leaveTypeId,
        2099,
        2,
        actorUserId,
        expect.anything(),
      );
      expect(attendanceRepo.removeFutureLeaveAttendance).toHaveBeenCalled();
    });

    it('Tier 3: should place past/in-progress APPROVED leave into CANCELLATION_REQUESTED for HR review', async () => {
      // Past date (2020) guarantees startDate <= today
      const pastApprovedRequest: LeaveRequestLean = {
        _id: requestId,
        employeeId: mockEmployee._id,
        leaveTypeId,
        startDate: '2020-01-10',
        endDate: '2020-01-11',
        totalDays: 2,
        yearBreakdown: [{ year: 2020, days: 2 }],
        status: LeaveRequestStatus.APPROVED,
      } as unknown as LeaveRequestLean;

      leaveRequestRepo.findById.mockResolvedValue(pastApprovedRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveRequestRepo.updateStatus.mockResolvedValue({
        ...pastApprovedRequest,
        status: LeaveRequestStatus.CANCELLATION_REQUESTED,
      });

      const result = await service.cancelLeave(actorUserId, requestId, {
        reason: 'I actually worked on that past date from home',
      });

      expect(result.status).toBe(LeaveRequestStatus.CANCELLATION_REQUESTED);
      // Crucial: Must NOT restore balance or remove attendance automatically without HR reconciliation
      expect(leaveBalanceRepo.creditCancelledBalance).not.toHaveBeenCalled();
      expect(attendanceRepo.removeFutureLeaveAttendance).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LEAVE_CANCELLATION_REQUESTED',
        }),
        expect.anything(),
      );
    });
  });

  // ===========================================================================
  // 5. RBAC & DYNAMIC MANAGER AUTHORIZATION
  // ===========================================================================

  describe('RBAC & Dynamic Manager Authorization', () => {
    it('should allow assigned reporting manager to approve leave', async () => {
      leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockManager);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveRequestRepo.updateStatus.mockResolvedValue({
        ...pendingRequest,
        status: LeaveRequestStatus.APPROVED,
      });
      leaveBalanceRepo.debitApprovedBalance.mockResolvedValue(mockBalance);

      const approved = await service.approveLeave(managerUserId, requestId, {
        remarks: 'Manager approval granted',
      });

      expect(approved.status).toBe(LeaveRequestStatus.APPROVED);
    });

    it('should prohibit self-approval by an employee', async () => {
      leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);

      await expect(
        service.approveLeave(actorUserId, requestId, {
          remarks: 'Self approval attempt',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Employees cannot approve their own leave requests',
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('should prohibit unauthorized peer employee from approving leave', async () => {
      const peerEmp: EmployeeLean = {
        ...mockEmployee,
        _id: new Types.ObjectId(),
        userId: peerUserId,
      };
      leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
      employeeRepo.findByUserId.mockResolvedValue(peerEmp);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      authorizationService.hasPermission.mockResolvedValue(false);

      await expect(
        service.approveLeave(peerUserId, requestId, {
          remarks: 'Peer unauthorized approval',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Only the assigned reporting manager or authorized HR can approve leave requests',
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('should allow HR user with LEAVES_APPROVE permission to override and approve', async () => {
      const hrEmp: EmployeeLean = {
        ...mockEmployee,
        _id: new Types.ObjectId(),
        userId: peerUserId,
        reportingManagerId: null,
      };
      leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
      employeeRepo.findByUserId.mockResolvedValue(hrEmp);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      authorizationService.hasPermission.mockResolvedValue(true);
      leaveRequestRepo.updateStatus.mockResolvedValue({
        ...pendingRequest,
        status: LeaveRequestStatus.APPROVED,
      });
      leaveBalanceRepo.debitApprovedBalance.mockResolvedValue(mockBalance);

      const approved = await service.approveLeave(peerUserId, requestId, {
        remarks: 'HR Administrative override approval',
      });

      expect(approved.status).toBe(LeaveRequestStatus.APPROVED);
    });
  });

  // ===========================================================================
  // 6. CONCURRENCY SERIALIZATION MUTEX (PART 4)
  // ===========================================================================

  describe('Part 4: Concurrency Serialization Mutex', () => {
    it('should acquire write lock on employee aggregate root to serialize concurrent submissions', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      holidayRepo.findApplicableHolidays.mockResolvedValue([]);
      leaveRequestRepo.findOverlappingRequests.mockResolvedValue([]);
      leaveBalanceRepo.reserveBalance.mockResolvedValue({
        ...mockBalance,
        pendingDays: 2,
        availableBalance: 10,
      });
      leaveRequestRepo.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        leaveTypeSnapshot: {
          name: mockLeaveType.name,
          code: mockLeaveType.code,
          isPaid: mockLeaveType.isPaid,
          allowHalfDay: mockLeaveType.allowHalfDay,
          deductWeekends: mockLeaveType.deductWeekends,
          deductHolidays: mockLeaveType.deductHolidays,
        },
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        totalDays: 2,
        isHalfDay: false,
        halfDaySession: null,
        yearBreakdown: [{ year: 2026, days: 2 }],
        reason: 'Annual Vacation',
        attachmentUrl: undefined,
        reportingManagerId: managerEmployeeId,
        status: LeaveRequestStatus.PENDING,
        appliedAt: new Date(),
        rejectionReason: undefined,
        cancellationReason: undefined,
        reconciliationNotes: undefined,
        approvalTimeline: [],
        deletedAt: null,
        createdBy: actorUserId,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.applyLeave(actorUserId, {
        leaveTypeId: leaveTypeId.toString(),
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        reason: 'Annual Vacation',
      });

      // Verifies the mutex touched the employee document inside the transaction
      expect(employeeRepo.updateById).toHaveBeenCalledWith(
        employeeId,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ===========================================================================
  // 7. YEAR-END CARRY-FORWARD AUTOMATION (PART 10)
  // ===========================================================================

  describe('Part 10: Year-End Carry-Forward Automation (Tests 1-36)', () => {
    const carryForwardLeaveType: LeaveTypeLean = {
      ...mockLeaveType,
      isCarryForwardEnabled: true,
      maxCarryForwardDays: 10,
      isActive: true,
    };

    beforeEach(() => {
      leaveTransactionRepo.findCarryForwardTransaction.mockResolvedValue(null);
    });

    // -------------------------------------------------------------------------
    // 1. Successful Carry Forward
    // -------------------------------------------------------------------------
    it('Test 1: should successfully execute valid carry forward and record ledger', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 5,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        carriedForwardDays: 5,
        availableBalance: 17,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: leaveTypeId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(result.processedEmployees).toBe(1);
      expect(result.totalCarriedForwardDays).toBe(5);
      expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalledWith(
        employeeId,
        leaveTypeId,
        2026,
        0,
        5,
        actorUserId,
        expect.anything(),
      );
      expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: LeaveTransactionType.CARRY_FORWARD,
          days: 5,
          year: 2026,
          remarks: 'Year-end carry forward of 5 days from year 2025',
          actorId: actorUserId,
        }),
        expect.anything(),
      );
    });

    it('Test 2: should carry forward less than maximum limit when unused balance is smaller', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...carryForwardLeaveType,
        maxCarryForwardDays: 10,
      });
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 5,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        carriedForwardDays: 5,
        availableBalance: 17,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: leaveTypeId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(result.totalCarriedForwardDays).toBe(5);
      expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalledWith(
        employeeId,
        leaveTypeId,
        2026,
        0,
        5,
        actorUserId,
        expect.anything(),
      );
    });

    it('Test 3: should carry forward exact amount when unused balance equals maximum limit', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...carryForwardLeaveType,
        maxCarryForwardDays: 10,
      });
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 10,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        carriedForwardDays: 10,
        availableBalance: 22,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: leaveTypeId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(result.totalCarriedForwardDays).toBe(10);
      expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalledWith(
        employeeId,
        leaveTypeId,
        2026,
        0,
        10,
        actorUserId,
        expect.anything(),
      );
    });

    it('Test 4: should cap carry forward at maximum limit when unused balance exceeds it (excess expires)', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...carryForwardLeaveType,
        maxCarryForwardDays: 10,
      });
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 15,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        carriedForwardDays: 10,
        availableBalance: 22,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: leaveTypeId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(result.totalCarriedForwardDays).toBe(10);
      expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalledWith(
        employeeId,
        leaveTypeId,
        2026,
        0,
        10,
        actorUserId,
        expect.anything(),
      );
    });

    // -------------------------------------------------------------------------
    // 2. Leave Type Policy Validation
    // -------------------------------------------------------------------------
    it('Test 5 & 8: should reject carry forward when leave type has carry forward disabled', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        isCarryForwardEnabled: false,
      });

      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2026,
          leaveTypeId: leaveTypeId.toString(),
          employeeId: employeeId.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Leave type '${mockLeaveType.name}' does not have carry forward enabled`,
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 6: should enforce configured maxCarryForwardDays limit', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...carryForwardLeaveType,
        maxCarryForwardDays: 5,
      });
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 8,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        carriedForwardDays: 5,
        availableBalance: 17,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: leaveTypeId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(result.totalCarriedForwardDays).toBe(5);
    });

    it('Test 7: should carry forward 0 days when maxCarryForwardDays is 0 (0 means no carry forward allowed, not unlimited)', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...carryForwardLeaveType,
        maxCarryForwardDays: 0,
      });
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 14,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: leaveTypeId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(result.totalCarriedForwardDays).toBe(0);
      expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // 3. Previous Year Balance Validation
    // -------------------------------------------------------------------------
    it('Test 9: should not create target balance or transaction when no previous year balance exists', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: leaveTypeId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(result.totalCarriedForwardDays).toBe(0);
      expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 10: should not create target balance or transaction when previous year balance is zero', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 0,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: leaveTypeId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(result.totalCarriedForwardDays).toBe(0);
      expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 11: should not carry forward negative balance as a positive credit', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: -2,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: leaveTypeId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(result.totalCarriedForwardDays).toBe(0);
      expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 12: should calculate carry forward from available unused balance after used days', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...carryForwardLeaveType,
        maxCarryForwardDays: 5,
      });
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        allocatedDays: 20,
        usedDays: 8,
        availableBalance: 12,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        carriedForwardDays: 5,
        availableBalance: 17,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: leaveTypeId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(result.totalCarriedForwardDays).toBe(5);
    });

    it('Test 13: should calculate carry forward after active pending reservations are deducted', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...carryForwardLeaveType,
        maxCarryForwardDays: 10,
      });
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        allocatedDays: 10,
        pendingDays: 3,
        availableBalance: 7,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        carriedForwardDays: 7,
        availableBalance: 19,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: leaveTypeId.toString(),
        employeeId: employeeId.toString(),
      });

      expect(result.totalCarriedForwardDays).toBe(7);
    });

    // -------------------------------------------------------------------------
    // 4. Year Validation
    // -------------------------------------------------------------------------
    it('Test 14: should reject same source and target year (2026 to 2026)', async () => {
      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2026,
          toYear: 2026,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'fromYear must be strictly less than toYear',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 15: should reject target year before source year (2026 to 2025)', async () => {
      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2026,
          toYear: 2025,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'fromYear must be strictly less than toYear',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 16: should reject non-consecutive years (2024 to 2026)', async () => {
      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2024,
          toYear: 2026,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'toYear must be consecutive to fromYear (exactly fromYear + 1)',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 17: should reject year values outside supported range (< 2000 or > 2100) at domain level', async () => {
      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 0,
          toYear: 2026,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'fromYear must be an integer between 2000 and 2100',
          HttpStatus.BAD_REQUEST,
        ),
      );

      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2101,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'toYear must be an integer between 2000 and 2100',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    // -------------------------------------------------------------------------
    // 5. Employee Validation
    // -------------------------------------------------------------------------
    it('Test 19: should reject nonexistent employee with 404 Not Found', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue(null);

      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2026,
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Employee not found',
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('Test 20: should reject soft-deleted employee with 404 Not Found', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        deletedAt: new Date(),
      });

      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2026,
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Employee not found',
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('Test 21a: should reject terminated employee with 400 Bad Request', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: EmploymentStatus.TERMINATED,
      });

      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2026,
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Employee is not eligible for leave carry forward',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 21b: should reject resigned employee with 400 Bad Request', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: EmploymentStatus.RESIGNED,
      });

      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2026,
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Employee is not eligible for leave carry forward',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 21c: should permit probation employee for carry forward', async () => {
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: EmploymentStatus.PROBATION,
      });
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 4,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        carriedForwardDays: 4,
        availableBalance: 16,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
      });

      expect(result.totalCarriedForwardDays).toBe(4);
    });

    it('Test 21d: should reject notice period employee with 400 Bad Request', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: EmploymentStatus.NOTICE_PERIOD,
      });

      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2026,
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Employee is not eligible for leave carry forward',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 22: batch carry forward should only process ACTIVE and PROBATION employees and exclude NOTICE_PERIOD, TERMINATED, RESIGNED', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      const empActive = {
        ...mockEmployee,
        _id: new Types.ObjectId(),
        employmentStatus: EmploymentStatus.ACTIVE,
      };
      const empProbation = {
        ...mockEmployee,
        _id: new Types.ObjectId(),
        employmentStatus: EmploymentStatus.PROBATION,
      };
      const empNotice = {
        ...mockEmployee,
        _id: new Types.ObjectId(),
        employmentStatus: EmploymentStatus.NOTICE_PERIOD,
      };
      const empTerminated = {
        ...mockEmployee,
        _id: new Types.ObjectId(),
        employmentStatus: EmploymentStatus.TERMINATED,
      };
      const empResigned = {
        ...mockEmployee,
        _id: new Types.ObjectId(),
        employmentStatus: EmploymentStatus.RESIGNED,
      };

      employeeRepo.findList.mockResolvedValue({
        data: [empActive, empProbation, empNotice, empTerminated, empResigned],
        meta: {
          total: 5,
          page: 1,
          limit: 1000,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 5,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        carriedForwardDays: 5,
        availableBalance: 17,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        leaveTypeId: leaveTypeId.toString(),
      });

      // Only ACTIVE and PROBATION (2 employees) are processed, NOT notice period, terminated, or resigned
      expect(result.processedEmployees).toBe(2);
      expect(result.totalCarriedForwardDays).toBe(10);
    });

    // -------------------------------------------------------------------------
    // 6. Leave Type Validation
    // -------------------------------------------------------------------------
    it('Test 23: should reject nonexistent leave type with 404 Not Found', async () => {
      leaveTypeRepo.findById.mockResolvedValue(null);

      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2026,
          leaveTypeId: leaveTypeId.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Leave type not found',
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('Test 24: should reject inactive leave type with 400 Bad Request', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...carryForwardLeaveType,
        isActive: false,
      });

      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2026,
          leaveTypeId: leaveTypeId.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Cannot carry forward for inactive leave type '${carryForwardLeaveType.name}'`,
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    // -------------------------------------------------------------------------
    // 7. Duplicate / Idempotency Protection
    // -------------------------------------------------------------------------
    it('Test 25 & 26: should reject duplicate carry forward execution with 409 Conflict without double-crediting', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      const existingTx: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.CARRY_FORWARD,
        days: 5,
        previousAvailable: 12,
        newAvailable: 17,
        referenceId: null,
        referenceType: 'YearEndCarryForward',
        remarks: 'Year-end carry forward of 5 days from year 2025',
        actorId: actorUserId,
        createdAt: new Date(),
      };
      leaveTransactionRepo.findCarryForwardTransaction.mockResolvedValue(
        existingTx,
      );

      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2026,
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Carry forward for leave type '${carryForwardLeaveType.name}' has already been processed for year 2026`,
          HttpStatus.CONFLICT,
        ),
      );

      expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 27: should add carry forward to existing target year allocation without overwriting', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 5,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        allocatedDays: 10,
        carriedForwardDays: 5,
        availableBalance: 15,
      });

      const result = await service.processYearEndCarryForward(actorUserId, {
        fromYear: 2025,
        toYear: 2026,
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
      });

      expect(result.totalCarriedForwardDays).toBe(5);
      expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalledWith(
        employeeId,
        leaveTypeId,
        2026,
        0,
        5,
        actorUserId,
        expect.anything(),
      );
    });

    // -------------------------------------------------------------------------
    // 8. Balance and Ledger Integrity
    // -------------------------------------------------------------------------
    it('Test 28 & 29: should create immutable ledger transaction and audit log with full details', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 5,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        allocatedDays: 10,
        carriedForwardDays: 5,
        availableBalance: 15,
      });

      await service.processYearEndCarryForward(
        actorUserId,
        {
          fromYear: 2025,
          toYear: 2026,
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
        },
        { ipAddress: '10.0.0.1', userAgent: 'JestTest' },
      );

      expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId,
          leaveTypeId,
          year: 2026,
          transactionType: LeaveTransactionType.CARRY_FORWARD,
          days: 5,
          previousAvailable: 10,
          newAvailable: 15,
          remarks: 'Year-end carry forward of 5 days from year 2025',
          actorId: actorUserId,
        }),
        expect.anything(),
      );

      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: actorUserId,
          action: AuditAction.LEAVE_BALANCE_ADJUSTED,
          details: {
            fromYear: 2025,
            toYear: 2026,
            employeeId,
            leaveTypeId,
            carriedForwardDays: 5,
          },
        }),
        expect.anything(),
      );
    });

    it('Test 31: should roll back transaction if ledger write fails', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 5,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        carriedForwardDays: 5,
        availableBalance: 17,
      });
      leaveTransactionRepo.create.mockRejectedValue(
        new Error('Primary replica set network partition during ledger insert'),
      );

      await expect(
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2026,
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
        }),
      ).rejects.toThrow(
        'Primary replica set network partition during ledger insert',
      );

      expect(leaveTransactionRepo.create).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // 9. Concurrency / Race Conditions
    // -------------------------------------------------------------------------
    it('Test 36: should prevent double-crediting when two carry forward operations execute concurrently', async () => {
      leaveTypeRepo.findById.mockResolvedValue(carryForwardLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue({
        ...mockBalance,
        year: 2025,
        availableBalance: 5,
      });
      leaveBalanceRepo.upsertAllocation.mockResolvedValue({
        ...mockBalance,
        year: 2026,
        carriedForwardDays: 5,
        availableBalance: 17,
      });

      const existingTx: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.CARRY_FORWARD,
        days: 5,
        previousAvailable: 12,
        newAvailable: 17,
        referenceId: null,
        referenceType: 'YearEndCarryForward',
        remarks: 'Year-end carry forward of 5 days from year 2025',
        actorId: actorUserId,
        createdAt: new Date(),
      };

      leaveTransactionRepo.findCarryForwardTransaction
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingTx);

      const [res1, res2] = await Promise.all([
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2026,
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
        }),
        service.processYearEndCarryForward(actorUserId, {
          fromYear: 2025,
          toYear: 2026,
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
        }),
      ]);

      expect(res1.totalCarriedForwardDays + res2.totalCarriedForwardDays).toBe(
        5,
      );
      expect(leaveTransactionRepo.create).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // 8. COMP-OFF REDEMPTION TRACKING (PART 12)
  // ===========================================================================

  describe('Part 12: Comp-Off Redemption Tracking', () => {
    it('should redeem available comp-off records upon COMP_OFF leave approval', async () => {
      const compOffRequestId = new Types.ObjectId();
      const compOffLeaveRequest: LeaveRequestLean = {
        _id: compOffRequestId,
        employeeId,
        leaveTypeId,
        leaveTypeSnapshot: {
          name: 'Compensatory Off',
          code: 'COMP_OFF',
          isPaid: true,
          allowHalfDay: false,
          deductWeekends: false,
          deductHolidays: false,
        },
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        totalDays: 1,
        isHalfDay: false,
        halfDaySession: null,
        yearBreakdown: [{ year: 2026, days: 1 }],
        reason: 'Comp Off Redemption',
        attachmentUrl: undefined,
        reportingManagerId: managerEmployeeId,
        status: LeaveRequestStatus.PENDING,
        appliedAt: new Date(),
        rejectionReason: undefined,
        cancellationReason: undefined,
        reconciliationNotes: undefined,
        approvalTimeline: [],
        deletedAt: null,
        createdBy: actorUserId,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      leaveRequestRepo.findById.mockResolvedValue(compOffLeaveRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockManager);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveRequestRepo.updateStatus.mockResolvedValue({
        ...compOffLeaveRequest,
        status: LeaveRequestStatus.APPROVED,
      });
      leaveBalanceRepo.debitApprovedBalance.mockResolvedValue(mockBalance);

      const mockCompOffRecord: CompOffRecordLean = {
        _id: new Types.ObjectId(),
        employeeId,
        attendanceDate: '2026-05-10',
        overtimeMinutes: 480,
        earnedDays: 1,
        status: CompOffStatus.APPROVED,
        expiryDate: '2026-08-10',
        redeemedAt: null,
        redeemedLeaveRequestId: null,
        reason: 'Worked Sunday',
        reviewedBy: managerUserId,
        reviewedAt: new Date(),
        reviewRemarks: 'Approved comp off',
        deletedAt: null,
        createdBy: actorUserId,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      compOffRepo.findAvailableCompOffs.mockResolvedValue([mockCompOffRecord]);

      await service.approveLeave(managerUserId, compOffRequestId, {
        remarks: 'Approved comp off leave',
      });

      expect(compOffRepo.redeemCompOff).toHaveBeenCalledWith(
        mockCompOffRecord._id,
        compOffRequestId,
        expect.anything(),
      );
    });
  });

  // ===========================================================================
  // 9. CALENDAR & SCHEDULE VISUALIZATION (PART 13)
  // ===========================================================================

  describe('Part 13: Calendar & Schedule Visualization', () => {
    it('should retrieve personal leave calendar and branch holidays', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveRequestRepo.findOverlappingRequests.mockResolvedValue([]);
      holidayRepo.findApplicableHolidays.mockResolvedValue([]);

      const calendar = await service.getMyCalendar(actorUserId, {
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      });

      expect(calendar.employeeId).toEqual(mockEmployee._id);
      expect(calendar.startDate).toBe('2026-06-01');
      expect(calendar.endDate).toBe('2026-06-30');
    });

    it('should retrieve team calendar for reporting manager', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockManager);
      employeeRepo.findByReportingManager.mockResolvedValue([mockEmployee]);
      leaveRequestRepo.findList.mockResolvedValue({
        data: [],
        meta: {
          total: 0,
          page: 1,
          limit: 500,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });
      holidayRepo.findApplicableHolidays.mockResolvedValue([]);

      const teamCalendar = await service.getTeamCalendar(managerUserId, {
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      });

      expect(teamCalendar.managerId).toEqual(mockManager._id);
      expect(teamCalendar.teamMembers.length).toBe(1);
    });

    it('should retrieve organization calendar scoped by branch and department', async () => {
      employeeRepo.findList.mockResolvedValue({
        data: [mockEmployee],
        meta: {
          total: 1,
          page: 1,
          limit: 1000,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });
      leaveRequestRepo.findList.mockResolvedValue({
        data: [],
        meta: {
          total: 0,
          page: 1,
          limit: 1000,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });
      holidayRepo.findApplicableHolidays.mockResolvedValue([]);

      const orgCalendar = await service.getOrganizationCalendar({
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        branchId: branchId.toString(),
      });

      expect(orgCalendar.startDate).toBe('2026-06-01');
      expect(orgCalendar.endDate).toBe('2026-06-30');
      expect(employeeRepo.findList).toHaveBeenCalledWith(
        expect.objectContaining({
          branchId: branchId.toString(),
        }),
      );
    });
  });

  // ===========================================================================
  // 10. VALIDATION GUARDS & EDGE CASES
  // ===========================================================================

  describe('Validation Guards & Edge Cases', () => {
    it('should reject application prior to employee joining date', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee); // joining: 2025-01-01

      await expect(
        service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2024-12-15',
          endDate: '2024-12-20',
          reason: 'Pre-joining vacation',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Cannot apply for leave prior to date of joining (2026-01-01)',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should reject application when leave type is inactive', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        isActive: false,
      });

      await expect(
        service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          reason: 'Vacation on inactive type',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Leave type '${mockLeaveType.name}' is currently inactive`,
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should reject application when overlapping request exists in transaction', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      holidayRepo.findApplicableHolidays.mockResolvedValue([]);
      leaveRequestRepo.findOverlappingRequests.mockResolvedValue([
        pendingRequest,
      ]);

      await expect(
        service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          reason: 'Duplicate overlapping request',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'You already have a pending or approved leave request overlapping dates 2026-06-01 to 2026-06-02',
          HttpStatus.CONFLICT,
        ),
      );
    });
  });

  // ===========================================================================
  // 11. REJECTION WORKFLOW
  // ===========================================================================

  describe('Rejection Workflow', () => {
    it('should reject pending leave, release balance reservation and record ledger', async () => {
      leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockManager);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveRequestRepo.updateStatus.mockResolvedValue({
        ...pendingRequest,
        status: LeaveRequestStatus.REJECTED,
        rejectionReason: 'Project deadline conflict',
      });
      leaveBalanceRepo.releaseReservation.mockResolvedValue(mockBalance);

      const rejected = await service.rejectLeave(managerUserId, requestId, {
        reason: 'Project deadline conflict',
      });

      expect(rejected.status).toBe(LeaveRequestStatus.REJECTED);
      expect(leaveBalanceRepo.releaseReservation).toHaveBeenCalledWith(
        mockEmployee._id,
        leaveTypeId,
        2026,
        2,
        managerUserId,
        expect.anything(),
      );
      expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: LeaveTransactionType.RESERVATION_RELEASE,
          days: 2,
        }),
        expect.anything(),
      );
    });

    it('should prohibit self-rejection by applicant', async () => {
      leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);

      await expect(
        service.rejectLeave(actorUserId, requestId, {
          reason: 'Trying to reject my own leave',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Employees cannot reject their own leave requests',
          HttpStatus.FORBIDDEN,
        ),
      );
    });
  });

  // ===========================================================================
  // 12. LEAVE TYPES & HOLIDAY CRUD WORKFLOWS
  // ===========================================================================

  describe('Leave Types & Holiday CRUD Workflows', () => {
    it('should create a new leave type successfully', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.create.mockResolvedValue(mockLeaveType);

      const created = await service.createLeaveType(actorUserId, {
        name: 'Paid Casual Leave',
        code: 'CL',
        isPaid: true,
        annualAllocation: 12,
        allowHalfDay: true,
        allowNegativeBalance: false,
        allowDuringNoticePeriod: false,
      });

      expect(created.code).toBe('CL');
      expect(leaveTypeRepo.create).toHaveBeenCalled();
    });

    it('should reject creating leave type with duplicate code', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(mockLeaveType);

      await expect(
        service.createLeaveType(actorUserId, {
          name: 'Another Casual Leave',
          code: 'CL',
          isPaid: true,
          annualAllocation: 12,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          "Leave type with code 'CL' already exists",
          HttpStatus.CONFLICT,
        ),
      );
    });

    it('5.1: should persist zero annual allocation (annualAllocation: 0)', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.create.mockImplementation((payload) =>
        Promise.resolve({
          ...mockLeaveType,
          ...payload,
          _id: new Types.ObjectId(),
        }),
      );

      await service.createLeaveType(actorUserId, {
        name: 'Unpaid Leave',
        code: 'LWP',
        isPaid: false,
        annualAllocation: 0,
      });

      expect(leaveTypeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          annualAllocation: 0,
          code: 'LWP',
        }),
        expect.anything(),
      );
    });

    it('5.3: should persist carry-forward disabled with 0 maxCarryForwardDays', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.create.mockImplementation((payload) =>
        Promise.resolve({
          ...mockLeaveType,
          ...payload,
          _id: new Types.ObjectId(),
        }),
      );

      await service.createLeaveType(actorUserId, {
        name: 'Casual Leave',
        code: 'CL',
        isPaid: true,
        isCarryForwardEnabled: false,
        maxCarryForwardDays: 0,
      });

      expect(leaveTypeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isCarryForwardEnabled: false,
          maxCarryForwardDays: 0,
        }),
        expect.anything(),
      );
    });

    it('5.4: should persist carry-forward enabled with 5 maxCarryForwardDays', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.create.mockImplementation((payload) =>
        Promise.resolve({
          ...mockLeaveType,
          ...payload,
          _id: new Types.ObjectId(),
        }),
      );

      await service.createLeaveType(actorUserId, {
        name: 'Privilege Leave',
        code: 'PL',
        isPaid: true,
        annualAllocation: 10,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 5,
      });

      expect(leaveTypeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isCarryForwardEnabled: true,
          maxCarryForwardDays: 5,
        }),
        expect.anything(),
      );
    });

    it('5.5 (Decision A): should allow carry-forward enabled with 0 maxCarryForwardDays representing unlimited', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.create.mockImplementation((payload) =>
        Promise.resolve({
          ...mockLeaveType,
          ...payload,
          _id: new Types.ObjectId(),
        }),
      );

      await service.createLeaveType(actorUserId, {
        name: 'Earned Leave',
        code: 'EL',
        isPaid: true,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 0,
      });

      expect(leaveTypeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isCarryForwardEnabled: true,
          maxCarryForwardDays: 0,
        }),
        expect.anything(),
      );
    });

    it('5.6 (Decision B): should normalize maxCarryForwardDays to 0 when carry-forward is disabled on creation', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.create.mockImplementation((payload) =>
        Promise.resolve({
          ...mockLeaveType,
          ...payload,
          _id: new Types.ObjectId(),
        }),
      );

      await service.createLeaveType(actorUserId, {
        name: 'Sick Leave',
        code: 'SL',
        isPaid: true,
        isCarryForwardEnabled: false,
        maxCarryForwardDays: 5,
      });

      expect(leaveTypeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isCarryForwardEnabled: false,
          maxCarryForwardDays: 0,
        }),
        expect.anything(),
      );
    });

    it('5.7: should reject createLeaveType when maxCarryForwardDays exceeds annualAllocation with carry-forward enabled', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);

      await expect(
        service.createLeaveType(actorUserId, {
          name: 'Casual Leave',
          code: 'CL',
          isPaid: true,
          annualAllocation: 6,
          isCarryForwardEnabled: true,
          maxCarryForwardDays: 7,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'maxCarryForwardDays (7) cannot exceed annualAllocation (6)',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('5.8: should allow createLeaveType when maxCarryForwardDays equals annualAllocation with carry-forward enabled', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.create.mockImplementation((payload) =>
        Promise.resolve({
          ...mockLeaveType,
          ...payload,
          _id: new Types.ObjectId(),
        }),
      );

      const result = await service.createLeaveType(actorUserId, {
        name: 'Casual Leave',
        code: 'CL',
        isPaid: true,
        annualAllocation: 6,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 6,
      });

      expect(result).toBeDefined();
      expect(leaveTypeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          annualAllocation: 6,
          isCarryForwardEnabled: true,
          maxCarryForwardDays: 6,
        }),
        expect.anything(),
      );
    });

    it('6.1 (Update): should update isCarryForwardEnabled: true and maxCarryForwardDays: 5', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        isCarryForwardEnabled: false,
        maxCarryForwardDays: 0,
      });
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.updateById.mockImplementation((id, update) =>
        Promise.resolve({
          ...mockLeaveType,
          ...update,
        }),
      );

      await service.updateLeaveType(actorUserId, leaveTypeId, {
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 5,
      });

      expect(leaveTypeRepo.updateById).toHaveBeenCalledWith(
        leaveTypeId,
        expect.objectContaining({
          isCarryForwardEnabled: true,
          maxCarryForwardDays: 5,
        }),
        expect.anything(),
      );
    });

    it('6.2 (Update): should update isCarryForwardEnabled: true and maxCarryForwardDays: 0 (unlimited)', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 5,
      });
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.updateById.mockImplementation((id, update) =>
        Promise.resolve({
          ...mockLeaveType,
          ...update,
        }),
      );

      await service.updateLeaveType(actorUserId, leaveTypeId, {
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 0,
      });

      expect(leaveTypeRepo.updateById).toHaveBeenCalledWith(
        leaveTypeId,
        expect.objectContaining({
          isCarryForwardEnabled: true,
          maxCarryForwardDays: 0,
        }),
        expect.anything(),
      );
    });

    it('6.3 (Update): should normalize maxCarryForwardDays to 0 when updating leave type to disabled carry-forward', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 10,
      });
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.updateById.mockImplementation((id, update) =>
        Promise.resolve({
          ...mockLeaveType,
          ...update,
        }),
      );

      await service.updateLeaveType(actorUserId, leaveTypeId, {
        isCarryForwardEnabled: false,
        maxCarryForwardDays: 10,
      });

      expect(leaveTypeRepo.updateById).toHaveBeenCalledWith(
        leaveTypeId,
        expect.objectContaining({
          isCarryForwardEnabled: false,
          maxCarryForwardDays: 0,
        }),
        expect.anything(),
      );
    });

    it('6.4 (Update): Existing annualAllocation = 6; update maxCarryForwardDays = 6 -> success', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        annualAllocation: 6,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 3,
      });
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.updateById.mockImplementation((id, update) =>
        Promise.resolve({
          ...mockLeaveType,
          ...update,
        }),
      );

      const result = await service.updateLeaveType(actorUserId, leaveTypeId, {
        maxCarryForwardDays: 6,
      });

      expect(result).toBeDefined();
      expect(leaveTypeRepo.updateById).toHaveBeenCalledWith(
        leaveTypeId,
        expect.objectContaining({
          maxCarryForwardDays: 6,
          updatedBy: actorUserId,
        }),
        expect.anything(),
      );
    });

    it('6.5 (Update): Existing annualAllocation = 6; update maxCarryForwardDays = 7 -> reject', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        annualAllocation: 6,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 3,
      });

      await expect(
        service.updateLeaveType(actorUserId, leaveTypeId, {
          maxCarryForwardDays: 7,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'maxCarryForwardDays (7) cannot exceed annualAllocation (6)',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('6.6 (Update): Update only isCarryForwardEnabled -> success', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        annualAllocation: 6,
        isCarryForwardEnabled: false,
        maxCarryForwardDays: 0,
      });
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.updateById.mockImplementation((id, update) =>
        Promise.resolve({
          ...mockLeaveType,
          ...update,
        }),
      );

      const result = await service.updateLeaveType(actorUserId, leaveTypeId, {
        isCarryForwardEnabled: true,
      });

      expect(result).toBeDefined();
      expect(leaveTypeRepo.updateById).toHaveBeenCalledWith(
        leaveTypeId,
        {
          isCarryForwardEnabled: true,
          updatedBy: actorUserId,
        },
        expect.anything(),
      );
    });

    it('6.7 (Update): Update annualAllocation and maxCarryForwardDays together -> validate their new combined values', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        annualAllocation: 6,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 3,
      });
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.updateById.mockImplementation((id, update) =>
        Promise.resolve({
          ...mockLeaveType,
          ...update,
        }),
      );

      // Valid combined update
      const validResult = await service.updateLeaveType(
        actorUserId,
        leaveTypeId,
        {
          annualAllocation: 10,
          maxCarryForwardDays: 10,
        },
      );

      expect(validResult).toBeDefined();
      expect(leaveTypeRepo.updateById).toHaveBeenCalledWith(
        leaveTypeId,
        expect.objectContaining({
          annualAllocation: 10,
          maxCarryForwardDays: 10,
        }),
        expect.anything(),
      );

      // Invalid combined update: maxCarryForwardDays (9) > annualAllocation (8)
      await expect(
        service.updateLeaveType(actorUserId, leaveTypeId, {
          annualAllocation: 8,
          maxCarryForwardDays: 9,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'maxCarryForwardDays (9) cannot exceed annualAllocation (8)',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('6.8 (Update): Verify partial updates preserve all unchanged fields and do not inject default values', async () => {
      const existingLeaveType: LeaveTypeLean = {
        ...mockLeaveType,
        name: 'Annual Paid Leave',
        code: 'AL',
        annualAllocation: 24,
        allowHalfDay: true,
        allowNegativeBalance: false,
        deductWeekends: true,
        deductHolidays: true,
        maxConsecutiveDays: 14,
        requiresAttachment: true,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 5,
      };

      leaveTypeRepo.findById.mockResolvedValue(existingLeaveType);
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.updateById.mockImplementation((id, update) =>
        Promise.resolve({
          ...existingLeaveType,
          ...update,
        }),
      );

      // Simulate partial update with only maxCarryForwardDays
      await service.updateLeaveType(actorUserId, leaveTypeId, {
        maxCarryForwardDays: 6,
      });

      // Verify updateById was called only with maxCarryForwardDays and updatedBy,
      // and that annualAllocation, deductWeekends, etc. were not overwritten with 0 or defaults
      expect(leaveTypeRepo.updateById).toHaveBeenCalledWith(
        leaveTypeId,
        {
          maxCarryForwardDays: 6,
          updatedBy: actorUserId,
        },
        expect.anything(),
      );
    });

    it('5.8: should persist allowNegativeBalance: true', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.create.mockImplementation((payload) =>
        Promise.resolve({
          ...mockLeaveType,
          ...payload,
          _id: new Types.ObjectId(),
        }),
      );

      await service.createLeaveType(actorUserId, {
        name: 'Emergency Advance Leave',
        code: 'EAL',
        isPaid: true,
        allowNegativeBalance: true,
      });

      expect(leaveTypeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          allowNegativeBalance: true,
        }),
        expect.anything(),
      );
    });

    it('5.9: should persist allowHalfDay: false', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.create.mockImplementation((payload) =>
        Promise.resolve({
          ...mockLeaveType,
          ...payload,
          _id: new Types.ObjectId(),
        }),
      );

      await service.createLeaveType(actorUserId, {
        name: 'Maternity Leave',
        code: 'ML',
        isPaid: true,
        allowHalfDay: false,
      });

      expect(leaveTypeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          allowHalfDay: false,
        }),
        expect.anything(),
      );
    });

    it('5.10: should persist requiresAttachment: true', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.create.mockImplementation((payload) =>
        Promise.resolve({
          ...mockLeaveType,
          ...payload,
          _id: new Types.ObjectId(),
        }),
      );

      await service.createLeaveType(actorUserId, {
        name: 'Medical Leave',
        code: 'MED',
        isPaid: true,
        requiresAttachment: true,
      });

      expect(leaveTypeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requiresAttachment: true,
        }),
        expect.anything(),
      );
    });

    it('6.8: should normalize duplicate applicableEmploymentStatuses when creating leave type', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.create.mockImplementation((payload) =>
        Promise.resolve({
          ...mockLeaveType,
          ...payload,
          _id: new Types.ObjectId(),
        }),
      );

      await service.createLeaveType(actorUserId, {
        name: 'Special Project Leave',
        code: 'SPL',
        isPaid: true,
        applicableEmploymentStatuses: [
          EmploymentStatus.ACTIVE,
          EmploymentStatus.ACTIVE,
          EmploymentStatus.PROBATION,
        ],
      });

      expect(leaveTypeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          applicableEmploymentStatuses: [
            EmploymentStatus.ACTIVE,
            EmploymentStatus.PROBATION,
          ],
        }),
        expect.anything(),
      );
    });

    it('6.8 (Update): should normalize duplicate applicableEmploymentStatuses when updating leave type', async () => {
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.updateById.mockImplementation((id, update) =>
        Promise.resolve({
          ...mockLeaveType,
          ...update,
        }),
      );

      await service.updateLeaveType(actorUserId, leaveTypeId, {
        applicableEmploymentStatuses: [
          EmploymentStatus.PROBATION,
          EmploymentStatus.PROBATION,
        ],
      });

      expect(leaveTypeRepo.updateById).toHaveBeenCalledWith(
        leaveTypeId,
        expect.objectContaining({
          applicableEmploymentStatuses: [EmploymentStatus.PROBATION],
        }),
        expect.anything(),
      );
    });

    it('7.1-7.5: should persist deductWeekends, deductHolidays and maxConsecutiveDays exactly in database', async () => {
      leaveTypeRepo.findByCode.mockResolvedValue(null);
      leaveTypeRepo.create.mockImplementation((payload) =>
        Promise.resolve({
          ...mockLeaveType,
          ...payload,
          _id: new Types.ObjectId(),
        }),
      );

      await service.createLeaveType(actorUserId, {
        name: 'Weekend Deduction Leave',
        code: 'WDL',
        description: 'Leave with weekend deduction',
        isPaid: true,
        annualAllocation: 12,
        allowHalfDay: false,
        allowNegativeBalance: false,
        allowDuringNoticePeriod: false,
        applicableEmploymentStatuses: [EmploymentStatus.ACTIVE],
        deductWeekends: true,
        deductHolidays: true,
        maxConsecutiveDays: 7,
      });

      expect(leaveTypeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deductWeekends: true,
          deductHolidays: true,
          maxConsecutiveDays: 7,
          code: 'WDL',
        }),
        expect.anything(),
      );
    });

    it('should explicitly set isActive when boolean is provided in updateLeaveTypeStatus', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        isActive: true,
      });
      leaveTypeRepo.updateById.mockResolvedValue({
        ...mockLeaveType,
        isActive: false,
      });

      const result = await service.updateLeaveTypeStatus(
        actorUserId,
        leaveTypeId,
        false,
        { ipAddress: '127.0.0.1', userAgent: 'test-agent' },
      );

      expect(leaveTypeRepo.updateById).toHaveBeenCalledWith(
        leaveTypeId,
        { isActive: false, updatedBy: actorUserId },
        expect.anything(),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.LEAVE_TYPE_STATUS_CHANGED,
          details: { previousStatus: true, newStatus: false },
        }),
        expect.anything(),
      );
      expect(result.isActive).toBe(false);
    });

    it('should toggle active status when isActive is omitted / undefined in updateLeaveTypeStatus', async () => {
      // Toggle true -> false
      leaveTypeRepo.findById.mockResolvedValueOnce({
        ...mockLeaveType,
        isActive: true,
      });
      leaveTypeRepo.updateById.mockResolvedValueOnce({
        ...mockLeaveType,
        isActive: false,
      });

      await service.updateLeaveTypeStatus(actorUserId, leaveTypeId, undefined);

      expect(leaveTypeRepo.updateById).toHaveBeenCalledWith(
        leaveTypeId,
        { isActive: false, updatedBy: actorUserId },
        expect.anything(),
      );

      // Toggle false -> true
      leaveTypeRepo.findById.mockResolvedValueOnce({
        ...mockLeaveType,
        isActive: false,
      });
      leaveTypeRepo.updateById.mockResolvedValueOnce({
        ...mockLeaveType,
        isActive: true,
      });

      await service.updateLeaveTypeStatus(actorUserId, leaveTypeId, undefined);

      expect(leaveTypeRepo.updateById).toHaveBeenCalledWith(
        leaveTypeId,
        { isActive: true, updatedBy: actorUserId },
        expect.anything(),
      );
    });

    it('should list leave types with pagination and filters', async () => {
      const mockPaginatedResult = {
        data: [mockLeaveType],
        meta: {
          total: 1,
          page: 2,
          limit: 10,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      };
      leaveTypeRepo.findList.mockResolvedValue(mockPaginatedResult);

      const result = await service.listLeaveTypes({
        page: 2,
        limit: 10,
        isActive: true,
        isPaid: false,
      });

      expect(leaveTypeRepo.findList).toHaveBeenCalledWith(
        { isActive: true, isPaid: false },
        2,
        10,
      );
      expect(result).toEqual(mockPaginatedResult);
    });

    it('should use default page=1 and limit=20 when pagination params are omitted in listLeaveTypes', async () => {
      const mockPaginatedResult = {
        data: [mockLeaveType],
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
      leaveTypeRepo.findList.mockResolvedValue(mockPaginatedResult);

      const result = await service.listLeaveTypes({});

      expect(leaveTypeRepo.findList).toHaveBeenCalledWith({}, 1, 20);
      expect(result).toEqual(mockPaginatedResult);
    });

    it('Test 1: should create organization-wide holiday with branchId: null and year populated', async () => {
      const mockCreatedHoliday: HolidayLean = {
        _id: new Types.ObjectId(),
        name: 'Republic Day',
        date: '2027-01-26',
        description: 'National holiday',
        type: HolidayType.PUBLIC,
        branchId: null,
        year: 2027,
        isActive: true,
        deletedAt: null,
        createdBy: actorUserId,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      holidayRepo.findByDateAndBranch.mockResolvedValue(null);
      holidayRepo.create.mockResolvedValue(mockCreatedHoliday);

      const result = await service.createHoliday(actorUserId, {
        name: 'Republic Day',
        date: '2027-01-26',
        description: 'National holiday',
        branchId: null,
      });

      expect(holidayRepo.findByDateAndBranch).toHaveBeenCalledWith(
        '2027-01-26',
        null,
      );
      expect(holidayRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Republic Day',
          date: '2027-01-26',
          year: 2027,
          branchId: null,
          createdBy: actorUserId,
        }),
        expect.anything(),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.HOLIDAY_CREATED,
          targetId: mockCreatedHoliday._id,
        }),
        expect.anything(),
      );
      expect(result.branchId).toBeNull();
      expect(result.year).toBe(2027);
    });

    it('Test 2: should create branch-specific holiday with verified branchId', async () => {
      const validBranchId = new Types.ObjectId('65a123456789012345678901');
      const mockCreatedHoliday: HolidayLean = {
        _id: new Types.ObjectId(),
        name: 'Regional Holiday',
        date: '2027-03-15',
        description: 'Branch-specific holiday',
        type: HolidayType.PUBLIC,
        branchId: validBranchId,
        year: 2027,
        isActive: true,
        deletedAt: null,
        createdBy: actorUserId,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      branchRepo.findById.mockResolvedValue({
        _id: validBranchId,
        name: 'Mumbai Branch',
      } as unknown as Branch);
      holidayRepo.findByDateAndBranch.mockResolvedValue(null);
      holidayRepo.create.mockResolvedValue(mockCreatedHoliday);

      const result = await service.createHoliday(actorUserId, {
        name: 'Regional Holiday',
        date: '2027-03-15',
        description: 'Branch-specific holiday',
        branchId: validBranchId.toString(),
      });

      expect(branchRepo.findById).toHaveBeenCalledWith(validBranchId);
      expect(result.branchId).toEqual(validBranchId);
    });

    it('Test 3: should reject duplicate organization-wide holiday with 409 Conflict', async () => {
      holidayRepo.findByDateAndBranch.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Republic Day',
        date: '2027-01-26',
        branchId: null,
      } as unknown as HolidayLean);

      await expect(
        service.createHoliday(actorUserId, {
          name: 'Republic Day',
          date: '2027-01-26',
          description: 'Duplicate holiday',
          branchId: null,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          "Holiday already exists for date '2027-01-26' and selected branch scope",
          HttpStatus.CONFLICT,
        ),
      );
    });

    it('Test 4: should allow holiday on same date for different branch', async () => {
      const branch2Id = new Types.ObjectId('65a123456789012345678902');
      const mockCreatedHoliday: HolidayLean = {
        _id: new Types.ObjectId(),
        name: 'Republic Day',
        date: '2027-01-26',
        description: 'Branch holiday',
        type: HolidayType.PUBLIC,
        branchId: branch2Id,
        year: 2027,
        isActive: true,
        deletedAt: null,
        createdBy: actorUserId,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      branchRepo.findById.mockResolvedValue({
        _id: branch2Id,
        name: 'Delhi Branch',
      } as unknown as Branch);
      holidayRepo.findByDateAndBranch.mockResolvedValue(null);
      holidayRepo.create.mockResolvedValue(mockCreatedHoliday);

      const result = await service.createHoliday(actorUserId, {
        name: 'Republic Day',
        date: '2027-01-26',
        description: 'Branch holiday',
        branchId: branch2Id.toString(),
      });

      expect(result.branchId).toEqual(branch2Id);
    });

    it('Test 5: should reject duplicate date within same branch with 409 Conflict', async () => {
      const branch1Id = new Types.ObjectId('65a123456789012345678901');
      branchRepo.findById.mockResolvedValue({
        _id: branch1Id,
        name: 'Mumbai Branch',
      } as unknown as Branch);
      holidayRepo.findByDateAndBranch.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Regional Holiday',
        date: '2027-03-15',
        branchId: branch1Id,
      } as unknown as HolidayLean);

      await expect(
        service.createHoliday(actorUserId, {
          name: 'Another Holiday',
          date: '2027-03-15',
          description: 'Duplicate branch date',
          branchId: branch1Id.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          "Holiday already exists for date '2027-03-15' and selected branch scope",
          HttpStatus.CONFLICT,
        ),
      );
    });

    it('Test 7: should reject empty/whitespace holiday name with 400 Bad Request', async () => {
      await expect(
        service.createHoliday(actorUserId, {
          name: '   ',
          date: '2027-05-01',
          description: 'Labour Day',
          branchId: null,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Holiday name cannot be empty or whitespace only',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 9: should reject invalid date format with 400 Bad Request', async () => {
      await expect(
        service.createHoliday(actorUserId, {
          name: 'Labour Day',
          date: '26-01-2027',
          description: 'National holiday',
          branchId: null,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'date must be in YYYY-MM-DD format',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 10: should reject invalid branch ID format with 400 Bad Request', async () => {
      await expect(
        service.createHoliday(actorUserId, {
          name: 'Regional Holiday',
          date: '2027-06-15',
          description: 'Regional holiday',
          branchId: '12345',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid branch ID '12345'",
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 11: should reject nonexistent branch with 404 Not Found', async () => {
      const nonExistentBranchId = '65a123456789012345678999';
      branchRepo.findById.mockResolvedValue(null);

      await expect(
        service.createHoliday(actorUserId, {
          name: 'Regional Holiday',
          date: '2027-06-15',
          description: 'Regional holiday',
          branchId: nonExistentBranchId,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Branch with ID '${nonExistentBranchId}' not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('Test 12: should reject invalid calendar date value with 400 Bad Request (2027-02-30)', async () => {
      await expect(
        service.createHoliday(actorUserId, {
          name: 'Invalid Holiday',
          date: '2027-02-30',
          description: 'Invalid calendar date',
          branchId: null,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Date '2027-02-30' is not a valid calendar date",
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('Test 14: should catch MongoDB duplicate key error (11000) during concurrent race condition and return 409 Conflict', async () => {
      holidayRepo.findByDateAndBranch.mockResolvedValue(null);
      const mongoDuplicateError = new Error(
        'E11000 duplicate key error collection: crm.holidays index: uq_holidays_date_branch dup key: { date: "2027-08-15", branchId: null }',
      );
      (mongoDuplicateError as unknown as { code: number }).code = 11000;
      holidayRepo.create.mockRejectedValue(mongoDuplicateError);

      await expect(
        service.createHoliday(actorUserId, {
          name: 'Independence Day',
          date: '2027-08-15',
          description: 'National holiday',
          branchId: null,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          "Holiday already exists for date '2027-08-15' and selected branch scope",
          HttpStatus.CONFLICT,
        ),
      );
    });

    it('should reject holiday creation when date and branch clash exists', async () => {
      holidayRepo.findByDateAndBranch.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Existing Holiday',
        date: '2026-12-25',
        type: HolidayType.PUBLIC,
        branchId: null,
        year: 2026,
        isActive: true,
        deletedAt: null,
        createdBy: null,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        service.createHoliday(actorUserId, {
          name: 'Christmas',
          date: '2026-12-25',
          type: HolidayType.PUBLIC,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          "Holiday already exists for date '2026-12-25' and selected branch scope",
          HttpStatus.CONFLICT,
        ),
      );
    });

    it('should reject createHoliday when branch is inactive with 400 Bad Request', async () => {
      const inactiveBranchId = new Types.ObjectId('65a123456789012345678901');
      branchRepo.findById.mockResolvedValue({
        _id: inactiveBranchId,
        name: 'Inactive Branch',
        isActive: false,
      } as unknown as Branch);

      await expect(
        service.createHoliday(actorUserId, {
          name: 'Branch Holiday',
          date: '2027-05-15',
          branchId: inactiveBranchId.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Cannot assign holiday to inactive branch 'Inactive Branch'",
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should reject updateHoliday when branchId is invalid ObjectId with 400 Bad Request', async () => {
      const holidayId = new Types.ObjectId();
      holidayRepo.findById.mockResolvedValue({
        _id: holidayId,
        name: 'Holiday',
        date: '2027-05-15',
        year: 2027,
        branchId: null,
      } as unknown as HolidayLean);

      await expect(
        service.updateHoliday(actorUserId, holidayId, {
          branchId: 'invalid-id',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid branch ID 'invalid-id'",
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should reject updateHoliday when branch does not exist with 404 Not Found', async () => {
      const holidayId = new Types.ObjectId();
      const nonExistentBranchId = new Types.ObjectId().toString();
      holidayRepo.findById.mockResolvedValue({
        _id: holidayId,
        name: 'Holiday',
        date: '2027-05-15',
        year: 2027,
        branchId: null,
      } as unknown as HolidayLean);
      branchRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateHoliday(actorUserId, holidayId, {
          branchId: nonExistentBranchId,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Branch with ID '${nonExistentBranchId}' not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('should reject updateHoliday when branch is soft-deleted with 404 Not Found', async () => {
      const holidayId = new Types.ObjectId();
      const deletedBranchId = new Types.ObjectId();
      holidayRepo.findById.mockResolvedValue({
        _id: holidayId,
        name: 'Holiday',
        date: '2027-05-15',
        year: 2027,
        branchId: null,
      } as unknown as HolidayLean);
      branchRepo.findById.mockResolvedValue({
        _id: deletedBranchId,
        name: 'Deleted Branch',
        isActive: true,
        deletedAt: new Date(),
      } as unknown as Branch);

      await expect(
        service.updateHoliday(actorUserId, holidayId, {
          branchId: deletedBranchId.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Branch with ID '${deletedBranchId.toString()}' not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
    });

    it('should reject updateHoliday when branch is inactive with 400 Bad Request', async () => {
      const holidayId = new Types.ObjectId();
      const inactiveBranchId = new Types.ObjectId();
      holidayRepo.findById.mockResolvedValue({
        _id: holidayId,
        name: 'Holiday',
        date: '2027-05-15',
        year: 2027,
        branchId: null,
      } as unknown as HolidayLean);
      branchRepo.findById.mockResolvedValue({
        _id: inactiveBranchId,
        name: 'Closed Branch',
        isActive: false,
      } as unknown as Branch);

      await expect(
        service.updateHoliday(actorUserId, holidayId, {
          branchId: inactiveBranchId.toString(),
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Cannot assign holiday to inactive branch 'Closed Branch'",
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should allow updateHoliday to update to a valid active branch', async () => {
      const holidayId = new Types.ObjectId();
      const newBranchId = new Types.ObjectId();
      holidayRepo.findById.mockResolvedValue({
        _id: holidayId,
        name: 'Holiday',
        date: '2027-05-15',
        year: 2027,
        branchId: null,
      } as unknown as HolidayLean);
      branchRepo.findById.mockResolvedValue({
        _id: newBranchId,
        name: 'Pune Branch',
        isActive: true,
      } as unknown as Branch);
      holidayRepo.findByDateAndBranch.mockResolvedValue(null);
      holidayRepo.updateById.mockResolvedValue({
        _id: holidayId,
        name: 'Holiday',
        date: '2027-05-15',
        year: 2027,
        branchId: newBranchId,
      } as unknown as HolidayLean);

      const result = await service.updateHoliday(actorUserId, holidayId, {
        branchId: newBranchId.toString(),
      });

      expect(result.branchId).toEqual(newBranchId);
      expect(holidayRepo.updateById).toHaveBeenCalledWith(
        holidayId,
        expect.objectContaining({
          branchId: newBranchId,
        }),
        expect.anything(),
      );
    });

    it('should allow updateHoliday to convert branch holiday to organization-wide (branchId: null)', async () => {
      const holidayId = new Types.ObjectId();
      const oldBranchId = new Types.ObjectId();
      holidayRepo.findById.mockResolvedValue({
        _id: holidayId,
        name: 'Holiday',
        date: '2027-05-15',
        year: 2027,
        branchId: oldBranchId,
      } as unknown as HolidayLean);
      holidayRepo.findByDateAndBranch.mockResolvedValue(null);
      holidayRepo.updateById.mockResolvedValue({
        _id: holidayId,
        name: 'Holiday',
        date: '2027-05-15',
        year: 2027,
        branchId: null,
      } as unknown as HolidayLean);

      const result = await service.updateHoliday(actorUserId, holidayId, {
        branchId: null,
      });

      expect(result.branchId).toBeNull();
      expect(holidayRepo.updateById).toHaveBeenCalledWith(
        holidayId,
        expect.objectContaining({
          branchId: null,
        }),
        expect.anything(),
      );
    });

    it('should list holidays with pagination and filters', async () => {
      const mockResult: PaginatedResult<HolidayLean> = {
        data: [
          {
            _id: new Types.ObjectId(),
            name: 'Republic Day',
            date: '2026-01-26',
            year: 2026,
            branchId: null,
            isActive: true,
          } as unknown as HolidayLean,
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
      holidayRepo.findList.mockResolvedValue(mockResult);

      const branchId = new Types.ObjectId().toString();
      const res = await service.listHolidays({
        year: 2026,
        branchId,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        isActive: true,
        page: 1,
        limit: 20,
      });

      expect(holidayRepo.findList).toHaveBeenCalledWith(
        expect.objectContaining({
          year: 2026,
          branchId: {
            $in: [null, new Types.ObjectId(branchId)],
          },
          date: { $gte: '2026-01-01', $lte: '2026-12-31' },
          isActive: true,
        }),
        1,
        20,
      );
      expect(res.data).toHaveLength(1);
      expect(res.meta.total).toBe(1);
    });
  });

  // ===========================================================================
  // 13. BALANCE ALLOCATION & ADJUSTMENT WORKFLOWS
  // ===========================================================================

  describe('Balance Allocation & Adjustment Workflows', () => {
    it('should allocate leave balance across employees', async () => {
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);
      leaveBalanceRepo.upsertAllocation.mockResolvedValue(mockBalance);

      const allocated = await service.allocateLeave(actorUserId, {
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
        year: 2026,
        days: 12,
      });

      expect(allocated.length).toBe(1);
      expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalledWith(
        mockEmployee._id,
        leaveTypeId,
        2026,
        12,
        0,
        actorUserId,
        expect.anything(),
      );
    });

    it('should reject allocation when days does not match leave type annualAllocation with 400 Bad Request', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        annualAllocation: 12,
      });
      employeeRepo.findById.mockResolvedValue(mockEmployee);

      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 15, // Mismatched: 15 !== 12
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Allocation days (15) does not match the standard annual entitlement of 12 days for leave type '${mockLeaveType.name}'`,
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 2: should reject duplicate allocation for the same employee, leave type and year with 409 Conflict', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 5,
      });
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(mockBalance);

      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
          carriedForwardDays: 3,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Leave balance already allocated for employee for leave type '${mockLeaveType.name}' in year 2026. Use balance adjustment API to modify existing balance.`,
          HttpStatus.CONFLICT,
        ),
      );

      expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });

    it('Test 2b: should catch MongoDB duplicate key error (11000) during concurrent duplicate allocation and return 409 Conflict', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 5,
      });
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);
      leaveBalanceRepo.upsertAllocation.mockRejectedValue({
        code: 11000,
        message:
          'E11000 duplicate key error collection: crm_hrms.leave_balances index: uq_leave_balances_emp_type_year dup key: { employeeId: ObjectId("..."), leaveTypeId: ObjectId("..."), year: 2026 }',
      });

      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
          carriedForwardDays: 3,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Leave balance already allocated for employee for leave type '${mockLeaveType.name}' in year 2026. Use balance adjustment API to modify existing balance.`,
          HttpStatus.CONFLICT,
        ),
      );

      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 10: should reject zero allocation days with 400 Bad Request and not create balance or transaction', async () => {
      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 0,
          carriedForwardDays: 3,
          remarks: 'Zero allocation test.',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Allocation days must be greater than 0',
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });

    it('Test 10b: should reject negative allocation days with 400 Bad Request', async () => {
      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: -5,
          carriedForwardDays: 3,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Allocation days must be greater than 0',
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 10c: should reject negative carried forward days with 400 Bad Request', async () => {
      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
          carriedForwardDays: -2,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Carried forward days cannot be negative',
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('Test 15: should reject allocation when employee has inactive status with 403 Forbidden', async () => {
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: 'inactive' as unknown as EmploymentStatus,
      });

      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          "Cannot allocate leave balance to employee with status 'inactive'",
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('Test 16: should reject allocation when employee is resigned with 403 Forbidden', async () => {
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: EmploymentStatus.RESIGNED,
      });

      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          "Cannot allocate leave balance to employee with status 'resigned'",
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('Test 17: should reject allocation when employee is soft-deleted with 404 Not Found', async () => {
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        deletedAt: new Date(),
      });

      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Target employee not found',
          HttpStatus.NOT_FOUND,
        ),
      );

      expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('should reject allocation when employee is terminated with 403 Forbidden', async () => {
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: EmploymentStatus.TERMINATED,
      });

      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          "Cannot allocate leave balance to employee with status 'terminated'",
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('should reject allocation when leave type is inactive with 400 Bad Request', async () => {
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        isActive: false,
      });

      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Cannot allocate balance for inactive leave type '${mockLeaveType.name}'`,
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should reject allocation when employee status is not eligible for leave type with 403 Forbidden', async () => {
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        employmentStatus: EmploymentStatus.PROBATION,
      });
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        applicableEmploymentStatuses: [EmploymentStatus.ACTIVE],
      });

      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          `Employees on 'probation' are not eligible for '${mockLeaveType.name}'`,
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('Test 21: should allow duplicate allocation in a different year (2027) without affecting 2026 balance', async () => {
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);
      const balance2027: LeaveBalanceLean = {
        ...mockBalance,
        year: 2027,
      };
      leaveBalanceRepo.upsertAllocation.mockResolvedValue(balance2027);

      const result = await service.allocateLeave(actorUserId, {
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
        year: 2027,
        days: 12,
        carriedForwardDays: 0,
        remarks: 'Annual FY2027 allocation.',
      });

      expect(result.length).toBe(1);
      expect(result[0].year).toBe(2027);
      expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalledWith(
        mockEmployee._id,
        leaveTypeId,
        2027,
        12,
        0,
        actorUserId,
        expect.anything(),
      );
    });

    it('Test 22 (Service): should use default remarks when remarks are omitted in request', async () => {
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);
      leaveBalanceRepo.upsertAllocation.mockResolvedValue(mockBalance);

      await service.allocateLeave(actorUserId, {
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
        year: 2026,
        days: 12,
      });

      expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          remarks: 'Annual leave allocation grant',
        }),
        expect.anything(),
      );
    });

    it('Test 25: should handle concurrent duplicate allocation where one succeeds and the other conflicts with 409', async () => {
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 5,
      });
      employeeRepo.findById.mockResolvedValue(mockEmployee);

      let callCount = 0;
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);
      leaveBalanceRepo.upsertAllocation.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(mockBalance);
        }
        const error = new Error('E11000 duplicate key error') as Error & {
          code: number;
        };
        error.code = 11000;
        return Promise.reject(error);
      });

      const payload = {
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
        year: 2026,
        days: 12,
        carriedForwardDays: 3,
        remarks: 'Annual FY2026 allocation grant.',
      };

      const [res1, res2] = await Promise.allSettled([
        service.allocateLeave(actorUserId, payload),
        service.allocateLeave(actorUserId, payload),
      ]);

      expect(res1.status).toBe('fulfilled');
      expect(res2.status).toBe('rejected');
      if (res2.status === 'rejected') {
        const err = res2.reason as AppError;
        expect(err.statusCode).toBe(HttpStatus.CONFLICT);
        expect(err.code).toBe(ErrorCode.RESOURCE_ALREADY_EXISTS);
      }
      expect(leaveTransactionRepo.create).toHaveBeenCalledTimes(1);
    });

    it('Test 26: should abort transaction and roll back when database failure occurs during transaction', async () => {
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);
      leaveBalanceRepo.upsertAllocation.mockResolvedValue(mockBalance);

      leaveTransactionRepo.create.mockRejectedValue(
        new Error('Database write failure: disk I/O error'),
      );

      await expect(
        service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
        }),
      ).rejects.toThrow('Database write failure: disk I/O error');

      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });

    describe('Carry-Forward Policy Validation in Allocation', () => {
      it('1. Carry-forward disabled + zero → success', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          isCarryForwardEnabled: false,
          maxCarryForwardDays: 0,
        });
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);
        leaveBalanceRepo.upsertAllocation.mockResolvedValue(mockBalance);

        const result = await service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
          carriedForwardDays: 0,
        });

        expect(result.length).toBe(1);
        expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalledWith(
          mockEmployee._id,
          leaveTypeId,
          2026,
          12,
          0,
          actorUserId,
          expect.anything(),
        );
      });

      it('2. Carry-forward disabled + positive value → rejection (400 Bad Request)', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          isCarryForwardEnabled: false,
          maxCarryForwardDays: 0,
        });
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);

        await expect(
          service.allocateLeave(actorUserId, {
            employeeId: employeeId.toString(),
            leaveTypeId: leaveTypeId.toString(),
            year: 2026,
            days: 12,
            carriedForwardDays: 3,
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Cannot allocate carried forward days because carry-forward is disabled for leave type '${mockLeaveType.name}'`,
            HttpStatus.BAD_REQUEST,
          ),
        );

        // Requirement 9: Rejected allocation -> no balance or ledger mutation
        expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
        expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
        expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
      });

      it('3. Carry-forward enabled + below maximum → success', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          isCarryForwardEnabled: true,
          maxCarryForwardDays: 10,
        });
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);
        leaveBalanceRepo.upsertAllocation.mockResolvedValue({
          ...mockBalance,
          carriedForwardDays: 4,
          availableBalance: 16,
        });

        const result = await service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
          carriedForwardDays: 4,
        });

        expect(result.length).toBe(1);
        expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalledWith(
          mockEmployee._id,
          leaveTypeId,
          2026,
          12,
          4,
          actorUserId,
          expect.anything(),
        );
      });

      it('4. Carry-forward enabled + exact maximum → success', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          isCarryForwardEnabled: true,
          maxCarryForwardDays: 10,
        });
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);
        leaveBalanceRepo.upsertAllocation.mockResolvedValue({
          ...mockBalance,
          carriedForwardDays: 10,
          availableBalance: 22,
        });

        const result = await service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
          carriedForwardDays: 10,
        });

        expect(result.length).toBe(1);
        expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalledWith(
          mockEmployee._id,
          leaveTypeId,
          2026,
          12,
          10,
          actorUserId,
          expect.anything(),
        );
      });

      it('5. Carry-forward enabled + above maximum (Test 14) → rejection (400 Bad Request)', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          isCarryForwardEnabled: true,
          maxCarryForwardDays: 10,
        });
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);

        await expect(
          service.allocateLeave(actorUserId, {
            employeeId: employeeId.toString(),
            leaveTypeId: leaveTypeId.toString(),
            year: 2026,
            days: 12,
            carriedForwardDays: 100,
            remarks: 'Testing carry-forward limit.',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Carried forward days (100) exceeds the maximum allowed limit of 10 days for leave type '${mockLeaveType.name}'`,
            HttpStatus.BAD_REQUEST,
          ),
        );

        // Requirement 9: Rejected allocation -> no balance or ledger mutation
        expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
        expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
        expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
      });

      it('7. Zero carried forward value with carry-forward enabled → success', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          isCarryForwardEnabled: true,
          maxCarryForwardDays: 10,
        });
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);
        leaveBalanceRepo.upsertAllocation.mockResolvedValue(mockBalance);

        const result = await service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
          carriedForwardDays: 0,
        });

        expect(result.length).toBe(1);
        expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalled();
      });

      it('8. Maximum configured as zero (unlimited carry-forward) → success with any positive amount', async () => {
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          isCarryForwardEnabled: true,
          maxCarryForwardDays: 0, // 0 = unlimited carry-forward under established policy
        });
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);
        leaveBalanceRepo.upsertAllocation.mockResolvedValue({
          ...mockBalance,
          carriedForwardDays: 50,
          availableBalance: 62,
        });

        const result = await service.allocateLeave(actorUserId, {
          employeeId: employeeId.toString(),
          leaveTypeId: leaveTypeId.toString(),
          year: 2026,
          days: 12,
          carriedForwardDays: 50,
        });

        expect(result.length).toBe(1);
        expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalledWith(
          mockEmployee._id,
          leaveTypeId,
          2026,
          12,
          50,
          actorUserId,
          expect.anything(),
        );
      });
    });

    it('should perform manual credit balance adjustment and record ledger', async () => {
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(mockBalance);
      leaveBalanceRepo.manualAdjust.mockResolvedValue({
        ...mockBalance,
        creditedDays: 2,
        availableBalance: 14,
      });

      const adjustDto: AdjustLeaveBalanceDto = {
        employeeId: employeeId.toString(),
        leaveTypeId: leaveTypeId.toString(),
        year: 2026,
        adjustmentType: 'CREDIT',
        days: 2,
        reason: 'Authorized management reward',
      };

      const adjusted: LeaveBalanceLean = await service.adjustBalance(
        actorUserId,
        adjustDto,
      );

      expect(adjusted.availableBalance).toBe(14);
      expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: LeaveTransactionType.MANUAL_CREDIT,
          days: 2,
        }),
        expect.anything(),
      );
    });

    it('should allow Super Admin / HR (actor without employee profile) to view any employee balance', async () => {
      const superAdminUserId = new Types.ObjectId();
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      authorizationService.hasPermission.mockResolvedValue(true);
      leaveBalanceRepo.findAllByEmployeeAndYear.mockResolvedValue([
        mockBalance,
      ]);

      const balances = await service.getEmployeeBalances(
        superAdminUserId,
        mockEmployee._id,
        2026,
      );

      expect(balances).toHaveLength(1);
      expect(leaveBalanceRepo.findAllByEmployeeAndYear).toHaveBeenCalledWith(
        mockEmployee._id,
        2026,
      );
    });

    describe('Leave Balance Transactions (GET /balances/employees/:id/transactions and ledger workflows)', () => {
      // -------------------------------------------------------------------------
      // 1. Allocation Creates Correct Ledger Transaction
      // -------------------------------------------------------------------------
      it('1. Allocation: should create balance and record immutable ALLOCATION ledger transaction', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          annualAllocation: 14,
        });
        leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);

        const createdBalance: LeaveBalanceLean = {
          _id: new Types.ObjectId(),
          employeeId: mockEmployee._id,
          leaveTypeId: mockLeaveType._id,
          year: 2026,
          allocatedDays: 14,
          carriedForwardDays: 0,
          creditedDays: 0,
          debitedDays: 0,
          pendingDays: 0,
          usedDays: 0,
          availableBalance: 14,
          deletedAt: null,
          updatedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        leaveBalanceRepo.upsertAllocation.mockResolvedValue(createdBalance);

        const createdTransaction: LeaveTransactionLean = {
          _id: new Types.ObjectId(),
          employeeId: mockEmployee._id,
          leaveTypeId: mockLeaveType._id,
          year: 2026,
          transactionType: LeaveTransactionType.ALLOCATION,
          days: 14,
          previousAvailable: 0,
          newAvailable: 14,
          referenceId: null,
          referenceType: 'Allocation',
          remarks: 'Annual general allocation grant',
          actorId: actorUserId,
          createdAt: new Date(),
        };
        leaveTransactionRepo.create.mockResolvedValue(createdTransaction);

        const result = await service.allocateLeave(actorUserId, {
          employeeId: mockEmployee._id.toString(),
          leaveTypeId: mockLeaveType._id.toString(),
          year: 2026,
          days: 14,
          remarks: 'Annual general allocation grant',
        });

        expect(result).toEqual([createdBalance]);
        expect(leaveBalanceRepo.upsertAllocation).toHaveBeenCalledWith(
          mockEmployee._id,
          mockLeaveType._id,
          2026,
          14,
          0,
          actorUserId,
          expect.anything(),
        );
        expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
          {
            employeeId: mockEmployee._id,
            leaveTypeId: mockLeaveType._id,
            year: 2026,
            transactionType: LeaveTransactionType.ALLOCATION,
            days: 14,
            previousAvailable: 0,
            newAvailable: 14,
            referenceId: null,
            referenceType: 'Allocation',
            remarks: 'Annual general allocation grant',
            actorId: actorUserId,
          },
          expect.anything(),
        );
        expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AuditAction.LEAVE_BALANCE_ALLOCATED,
            targetId: createdBalance._id,
            actorId: actorUserId,
          }),
          expect.anything(),
        );
        // Verify ledger consistency: newAvailable - previousAvailable === days
        expect(
          createdTransaction.newAvailable -
            createdTransaction.previousAvailable,
        ).toBe(14);
      });

      // -------------------------------------------------------------------------
      // 2. Approved Leave Creates Correct Debit Transaction
      // -------------------------------------------------------------------------
      it('2. Approved Leave: should debit leave balance and record APPROVAL_DEBIT transaction exactly once', async () => {
        const pendingReq: LeaveRequestLean = {
          ...pendingRequest,
          status: LeaveRequestStatus.PENDING,
          totalDays: 2,
          yearBreakdown: [{ year: 2026, days: 2 }],
        };
        leaveRequestRepo.findById.mockResolvedValue(pendingReq);
        employeeRepo.findByUserId.mockResolvedValue(mockManager);
        employeeRepo.findById.mockResolvedValue(mockEmployee);

        const approvedReq: LeaveRequestLean = {
          ...pendingReq,
          status: LeaveRequestStatus.APPROVED,
        };
        leaveRequestRepo.updateStatus.mockResolvedValue(approvedReq);

        const debitedBalance: LeaveBalanceLean = {
          ...mockBalance,
          pendingDays: 0,
          usedDays: 2,
          availableBalance: 10,
        };
        leaveBalanceRepo.debitApprovedBalance.mockResolvedValue(debitedBalance);

        await service.approveLeave(managerUserId, requestId, {
          remarks: 'Approved by Reporting Manager',
        });

        expect(leaveBalanceRepo.debitApprovedBalance).toHaveBeenCalledTimes(1);
        expect(leaveBalanceRepo.debitApprovedBalance).toHaveBeenCalledWith(
          mockEmployee._id,
          mockLeaveType._id,
          2026,
          2,
          managerUserId,
          expect.anything(),
        );
        expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
          {
            employeeId: mockEmployee._id,
            leaveTypeId: mockLeaveType._id,
            year: 2026,
            transactionType: LeaveTransactionType.APPROVAL_DEBIT,
            days: -2,
            previousAvailable: debitedBalance.availableBalance,
            newAvailable: debitedBalance.availableBalance,
            referenceId: requestId,
            referenceType: 'LeaveRequest',
            remarks: 'Leave approved by Reporting Manager',
            actorId: managerUserId,
          },
          expect.anything(),
        );

        // Verify deduction occurs exactly once: retry with non-pending status rejects with 409 Conflict
        leaveRequestRepo.findById.mockResolvedValue(approvedReq);
        leaveRequestRepo.updateStatus.mockResolvedValue(null);
        await expect(
          service.approveLeave(managerUserId, requestId, {
            remarks: 'Duplicate approve button click',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            'Cannot approve leave request: request is not in PENDING status',
            HttpStatus.CONFLICT,
          ),
        );
        expect(leaveBalanceRepo.debitApprovedBalance).toHaveBeenCalledTimes(1); // Not called again
      });

      // -------------------------------------------------------------------------
      // 3. Leave Cancellation Creates Correct Reversal
      // -------------------------------------------------------------------------
      it('3. Cancellation: should restore balance and record CANCELLATION_CREDIT reversal without modifying debit history', async () => {
        const approvedReq: LeaveRequestLean = {
          ...pendingRequest,
          status: LeaveRequestStatus.APPROVED,
          totalDays: 2,
          startDate: '2026-12-01',
          endDate: '2026-12-02',
          yearBreakdown: [{ year: 2026, days: 2 }],
        };
        leaveRequestRepo.findById.mockResolvedValue(approvedReq);
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);

        const cancelledReq: LeaveRequestLean = {
          ...approvedReq,
          status: LeaveRequestStatus.CANCELLED,
        };
        leaveRequestRepo.updateStatus.mockResolvedValue(cancelledReq);

        const restoredBalance: LeaveBalanceLean = {
          ...mockBalance,
          usedDays: 0,
          availableBalance: 12,
        };
        leaveBalanceRepo.creditCancelledBalance.mockResolvedValue(
          restoredBalance,
        );
        attendanceRepo.removeFutureLeaveAttendance.mockResolvedValue(undefined);

        await service.cancelLeave(actorUserId, requestId, {
          reason: 'Emergency travel cancelled',
        });

        expect(leaveBalanceRepo.creditCancelledBalance).toHaveBeenCalledTimes(
          1,
        );
        expect(leaveBalanceRepo.creditCancelledBalance).toHaveBeenCalledWith(
          mockEmployee._id,
          mockLeaveType._id,
          2026,
          2,
          actorUserId,
          expect.anything(),
        );
        expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
          {
            employeeId: mockEmployee._id,
            leaveTypeId: mockLeaveType._id,
            year: 2026,
            transactionType: LeaveTransactionType.CANCELLATION_CREDIT,
            days: 2,
            previousAvailable: 10,
            newAvailable: 12,
            referenceId: requestId,
            referenceType: 'LeaveRequest',
            remarks:
              'Approved leave cancelled; balance restored: Emergency travel cancelled',
            actorId: actorUserId,
          },
          expect.anything(),
        );

        // Verify cancellation occurs exactly once: retry on already cancelled request fails
        leaveRequestRepo.findById.mockResolvedValue(cancelledReq);
        await expect(
          service.cancelLeave(actorUserId, requestId, {
            reason: 'Duplicate cancel click',
          }),
        ).rejects.toThrow(AppError);
        expect(leaveBalanceRepo.creditCancelledBalance).toHaveBeenCalledTimes(
          1,
        ); // Not credited twice
      });

      // -------------------------------------------------------------------------
      // 4. Failed Transaction Does Not Create Partial Ledger Data
      // -------------------------------------------------------------------------
      it('4. Rollback: should abort transaction and roll back when ledger write fails', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          annualAllocation: 10,
        });
        leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);
        leaveBalanceRepo.upsertAllocation.mockResolvedValue(mockBalance);

        leaveTransactionRepo.create.mockRejectedValue(
          new Error('MongoDB replica set primary stepdown during ledger write'),
        );

        await expect(
          service.allocateLeave(actorUserId, {
            employeeId: mockEmployee._id.toString(),
            leaveTypeId: mockLeaveType._id.toString(),
            year: 2026,
            days: 10,
          }),
        ).rejects.toThrow(
          'MongoDB replica set primary stepdown during ledger write',
        );

        expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
      });

      // -------------------------------------------------------------------------
      // 5. Duplicate Operation Does Not Double-Credit
      // -------------------------------------------------------------------------
      it('5. Duplicate Guard: should reject duplicate allocation with 409 Conflict without double-crediting', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
        leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(mockBalance);

        await expect(
          service.allocateLeave(actorUserId, {
            employeeId: mockEmployee._id.toString(),
            leaveTypeId: mockLeaveType._id.toString(),
            year: 2026,
            days: 12,
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            `Leave balance already allocated for employee for leave type '${mockLeaveType.name}' in year 2026. Use balance adjustment API to modify existing balance.`,
            HttpStatus.CONFLICT,
          ),
        );

        expect(leaveBalanceRepo.upsertAllocation).not.toHaveBeenCalled();
        expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
      });

      it('5b. Concurrent Duplicate: should catch MongoDB E11000 duplicate key error and reject with 409 Conflict', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
        leaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValue(null);

        const mongoDupKeyError = new Error(
          'E11000 duplicate key error collection: leave_balances index: ix_leave_balances_emp_type_year',
        );
        leaveBalanceRepo.upsertAllocation.mockRejectedValue(mongoDupKeyError);

        await expect(
          service.allocateLeave(actorUserId, {
            employeeId: mockEmployee._id.toString(),
            leaveTypeId: mockLeaveType._id.toString(),
            year: 2026,
            days: 12,
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            `Leave balance already allocated for employee for leave type '${mockLeaveType.name}' in year 2026. Use balance adjustment API to modify existing balance.`,
            HttpStatus.CONFLICT,
          ),
        );

        expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
      });

      // -------------------------------------------------------------------------
      // 6. Transaction History Filters
      // -------------------------------------------------------------------------
      it('6. Filters: should pass leaveTypeId, year, and transactionType filters to repository query', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(true);

        const targetLeaveTypeId = new Types.ObjectId();
        leaveTransactionRepo.findList.mockResolvedValue({
          data: [],
          meta: {
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        });

        // Filter by leaveTypeId
        await service.getTransactions(actorUserId, mockEmployee._id, {
          leaveTypeId: targetLeaveTypeId.toString(),
        });
        expect(leaveTransactionRepo.findList).toHaveBeenCalledWith(
          {
            employeeId: mockEmployee._id,
            leaveTypeId: targetLeaveTypeId,
          },
          1,
          20,
        );

        // Filter by year
        await service.getTransactions(actorUserId, mockEmployee._id, {
          year: 2026,
        });
        expect(leaveTransactionRepo.findList).toHaveBeenCalledWith(
          {
            employeeId: mockEmployee._id,
            year: 2026,
          },
          1,
          20,
        );

        // Filter by transactionType
        await service.getTransactions(actorUserId, mockEmployee._id, {
          transactionType: LeaveTransactionType.ALLOCATION,
        });
        expect(leaveTransactionRepo.findList).toHaveBeenCalledWith(
          {
            employeeId: mockEmployee._id,
            transactionType: LeaveTransactionType.ALLOCATION,
          },
          1,
          20,
        );

        // Combined filters
        await service.getTransactions(actorUserId, mockEmployee._id, {
          leaveTypeId: targetLeaveTypeId.toString(),
          year: 2026,
          transactionType: LeaveTransactionType.APPROVAL_DEBIT,
          page: 2,
          limit: 10,
        });
        expect(leaveTransactionRepo.findList).toHaveBeenCalledWith(
          {
            employeeId: mockEmployee._id,
            leaveTypeId: targetLeaveTypeId,
            year: 2026,
            transactionType: LeaveTransactionType.APPROVAL_DEBIT,
          },
          2,
          10,
        );
      });

      // -------------------------------------------------------------------------
      // 7. Pagination
      // -------------------------------------------------------------------------
      it('7. Pagination: should return paginated transaction history exceeding page size with correct metadata', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(true);

        const pagedTransactions: LeaveTransactionLean[] = Array.from(
          { length: 10 },
          (_, i) => ({
            _id: new Types.ObjectId(),
            employeeId: mockEmployee._id,
            leaveTypeId: mockLeaveType._id,
            year: 2026,
            transactionType: LeaveTransactionType.APPROVAL_DEBIT,
            days: -1,
            previousAvailable: 10 - i,
            newAvailable: 9 - i,
            referenceId: new Types.ObjectId(),
            referenceType: 'LeaveRequest',
            remarks: `Leave debit item ${i + 1}`,
            actorId: managerUserId,
            createdAt: new Date(Date.now() - i * 60000),
          }),
        );

        leaveTransactionRepo.findList.mockResolvedValue({
          data: pagedTransactions,
          meta: {
            total: 25,
            page: 2,
            limit: 10,
            totalPages: 3,
            hasNextPage: true,
            hasPreviousPage: true,
          },
        });

        const result = await service.getTransactions(
          actorUserId,
          mockEmployee._id,
          {
            page: 2,
            limit: 10,
          },
        );

        expect(result.data).toHaveLength(10);
        expect(result.meta).toEqual({
          total: 25,
          page: 2,
          limit: 10,
          totalPages: 3,
          hasNextPage: true,
          hasPreviousPage: true,
        });
        expect(leaveTransactionRepo.findList).toHaveBeenCalledWith(
          { employeeId: mockEmployee._id },
          2,
          10,
        );
      });

      // -------------------------------------------------------------------------
      // 8. Authorization and Access Control
      // -------------------------------------------------------------------------
      it('8a. Auth - Superadmin / HR: should allow actor with LEAVES_VIEW to view any employee transactions', async () => {
        const superAdminUserId = new Types.ObjectId();
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(true);
        leaveTransactionRepo.findList.mockResolvedValue({
          data: [],
          meta: {
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        });

        const res = await service.getTransactions(
          superAdminUserId,
          mockEmployee._id,
          { page: 1, limit: 20 },
        );

        expect(res.data).toEqual([]);
        expect(leaveTransactionRepo.findList).toHaveBeenCalled();
      });

      it('8b. Auth - Self Access: should allow employee to view own transactions without LEAVES_VIEW permission', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(false);
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee); // self
        leaveTransactionRepo.findList.mockResolvedValue({
          data: [],
          meta: {
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        });

        const res = await service.getTransactions(
          actorUserId,
          mockEmployee._id,
          {},
        );

        expect(res.data).toEqual([]);
        expect(leaveTransactionRepo.findList).toHaveBeenCalled();
      });

      it('8c. Auth - Reporting Manager: should allow reporting manager to view reportee transactions without LEAVES_VIEW', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee); // reportingManagerId = mockManager._id
        authorizationService.hasPermission.mockResolvedValue(false);
        employeeRepo.findByUserId.mockResolvedValue(mockManager); // reporting manager
        leaveTransactionRepo.findList.mockResolvedValue({
          data: [],
          meta: {
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        });

        const res = await service.getTransactions(
          managerUserId,
          mockEmployee._id,
          {},
        );

        expect(res.data).toEqual([]);
        expect(leaveTransactionRepo.findList).toHaveBeenCalled();
      });

      it('8d. Auth - Unauthorized Peer: should throw 403 Forbidden when unauthorized employee attempts to view another peer transactions', async () => {
        const peerEmployee: EmployeeLean = {
          ...mockEmployee,
          _id: new Types.ObjectId(),
          userId: peerUserId,
          reportingManagerId: new Types.ObjectId(),
        };
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(false);
        employeeRepo.findByUserId.mockResolvedValue(peerEmployee); // peer

        await expect(
          service.getTransactions(peerUserId, mockEmployee._id, {}),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.FORBIDDEN,
            'Insufficient permission to view employee leave transactions',
            HttpStatus.FORBIDDEN,
          ),
        );
        expect(leaveTransactionRepo.findList).not.toHaveBeenCalled();
      });

      it('8e. Auth - No Employee Profile: should throw 403 Forbidden when actor without employee profile and without LEAVES_VIEW attempts access', async () => {
        const externalUserId = new Types.ObjectId();
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(false);
        employeeRepo.findByUserId.mockResolvedValue(null);

        await expect(
          service.getTransactions(externalUserId, mockEmployee._id, {}),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.FORBIDDEN,
            'Insufficient permission to view employee leave transactions',
            HttpStatus.FORBIDDEN,
          ),
        );
      });

      // -------------------------------------------------------------------------
      // 9. Employee Not Found / Invalid ID
      // -------------------------------------------------------------------------
      it('9a. Not Found: should throw 404 Not Found when target employee does not exist', async () => {
        employeeRepo.findById.mockResolvedValue(null);

        await expect(
          service.getTransactions(actorUserId, employeeId, {}),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Target employee not found',
            HttpStatus.NOT_FOUND,
          ),
        );
      });

      it('9b. Soft-Deleted: should throw 404 Not Found when target employee is soft-deleted', async () => {
        employeeRepo.findById.mockResolvedValue({
          ...mockEmployee,
          deletedAt: new Date(),
        });

        await expect(
          service.getTransactions(actorUserId, employeeId, {}),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Target employee not found',
            HttpStatus.NOT_FOUND,
          ),
        );
      });

      it('9c. Empty Ledger: should return 200 OK with empty array when employee exists but has no transactions', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(true);
        leaveTransactionRepo.findList.mockResolvedValue({
          data: [],
          meta: {
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        });

        const res = await service.getTransactions(
          actorUserId,
          mockEmployee._id,
          {},
        );

        expect(res.data).toEqual([]);
        expect(res.meta.total).toBe(0);
        expect(res.meta.page).toBe(1);
      });

      // -------------------------------------------------------------------------
      // 10. getMyTransactions (GET /api/v1/leaves/balances/me/transactions)
      // -------------------------------------------------------------------------
      it('10a. getMyTransactions: should resolve employee profile and return own transaction history', async () => {
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(false);
        leaveTransactionRepo.findList.mockResolvedValue({
          data: [],
          meta: {
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        });

        const res = await service.getMyTransactions(actorUserId, {
          page: 1,
          limit: 20,
        });

        expect(res.data).toEqual([]);
        expect(employeeRepo.findByUserId).toHaveBeenCalledWith(actorUserId);
        expect(leaveTransactionRepo.findList).toHaveBeenCalledWith(
          { employeeId: mockEmployee._id },
          1,
          20,
        );
      });

      it('10b. getMyTransactions: should throw 404 when employee profile not found for user', async () => {
        employeeRepo.findByUserId.mockResolvedValue(null);

        await expect(
          service.getMyTransactions(actorUserId, {}),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Employee profile not found for authenticated user',
            HttpStatus.NOT_FOUND,
          ),
        );
      });
    });

    describe('getEmployeeBalances (GET /api/v1/leaves/balances/employees/:id)', () => {
      it('should throw 404 Not Found when target employee does not exist', async () => {
        employeeRepo.findById.mockResolvedValue(null);

        await expect(
          service.getEmployeeBalances(actorUserId, employeeId, 2026),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Target employee not found',
            HttpStatus.NOT_FOUND,
          ),
        );
      });

      it('should throw 404 Not Found when target employee is soft-deleted', async () => {
        employeeRepo.findById.mockResolvedValue({
          ...mockEmployee,
          deletedAt: new Date(),
        });

        await expect(
          service.getEmployeeBalances(actorUserId, employeeId, 2026),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Target employee not found',
            HttpStatus.NOT_FOUND,
          ),
        );
      });

      it('should allow viewing when actor has leaves:view permission', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(true);
        leaveBalanceRepo.findAllByEmployeeAndYear.mockResolvedValue([
          mockBalance,
        ]);

        const balances = await service.getEmployeeBalances(
          actorUserId,
          mockEmployee._id,
          2026,
        );

        expect(balances).toHaveLength(1);
        expect(leaveBalanceRepo.findAllByEmployeeAndYear).toHaveBeenCalledWith(
          mockEmployee._id,
          2026,
        );
      });

      it('should allow viewing when actor is the employee themselves (self access)', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(false);
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        leaveBalanceRepo.findAllByEmployeeAndYear.mockResolvedValue([
          mockBalance,
        ]);

        const balances = await service.getEmployeeBalances(
          actorUserId,
          mockEmployee._id,
          2026,
        );

        expect(balances).toHaveLength(1);
      });

      it('should allow viewing when actor is the reporting manager of the employee', async () => {
        const reportingManagerEmployee: EmployeeLean = {
          ...mockEmployee,
          _id: managerEmployeeId,
          userId: managerUserId,
        };
        const subordinateEmployee: EmployeeLean = {
          ...mockEmployee,
          _id: employeeId,
          reportingManagerId: managerEmployeeId,
        };

        employeeRepo.findById.mockResolvedValue(subordinateEmployee);
        authorizationService.hasPermission.mockResolvedValue(false);
        employeeRepo.findByUserId.mockResolvedValue(reportingManagerEmployee);
        leaveBalanceRepo.findAllByEmployeeAndYear.mockResolvedValue([
          mockBalance,
        ]);

        const balances = await service.getEmployeeBalances(
          managerUserId,
          employeeId,
          2026,
        );

        expect(balances).toHaveLength(1);
      });

      it('should throw 403 Forbidden when actor has no view permission and is neither self nor reporting manager', async () => {
        const peerEmployee: EmployeeLean = {
          ...mockEmployee,
          _id: new Types.ObjectId(),
          userId: peerUserId,
        };
        const targetEmployee: EmployeeLean = {
          ...mockEmployee,
          _id: employeeId,
          reportingManagerId: managerEmployeeId,
        };

        employeeRepo.findById.mockResolvedValue(targetEmployee);
        authorizationService.hasPermission.mockResolvedValue(false);
        employeeRepo.findByUserId.mockResolvedValue(peerEmployee);

        await expect(
          service.getEmployeeBalances(peerUserId, employeeId, 2026),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.FORBIDDEN,
            'Insufficient permission to view employee leave balance',
            HttpStatus.FORBIDDEN,
          ),
        );
      });

      it('should default to current calendar year when year is omitted', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(true);
        leaveBalanceRepo.findAllByEmployeeAndYear.mockResolvedValue([]);

        const currentYear = new Date().getFullYear();
        const balances = await service.getEmployeeBalances(
          actorUserId,
          mockEmployee._id,
        );

        expect(balances).toEqual([]);
        expect(leaveBalanceRepo.findAllByEmployeeAndYear).toHaveBeenCalledWith(
          mockEmployee._id,
          currentYear,
        );
      });

      it('should return empty array when no balances are allocated for that year', async () => {
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(true);
        leaveBalanceRepo.findAllByEmployeeAndYear.mockResolvedValue([]);

        const balances = await service.getEmployeeBalances(
          actorUserId,
          mockEmployee._id,
          2028,
        );

        expect(balances).toEqual([]);
      });
    });
  });

  // ===========================================================================
  // 14. CRITICAL HIGH-RISK SCENARIOS AUDIT (SCENARIOS 1-10)
  // ===========================================================================

  describe('Critical High-Risk Scenarios Audit (Scenarios 1-10)', () => {
    // -------------------------------------------------------------------------
    // Scenario 1: Concurrent Overlapping Leave Requests
    // -------------------------------------------------------------------------
    it('Scenario 1: should acquire mutex lock on employee aggregate and block concurrent overlapping requests', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      holidayRepo.findApplicableHolidays.mockResolvedValue([]);
      leaveRequestRepo.findOverlappingRequests.mockResolvedValue([
        pendingRequest,
      ]);

      await expect(
        service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-08-01',
          endDate: '2026-08-02',
          reason: 'Concurrent duplicate leave attempt',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'You already have a pending or approved leave request overlapping dates 2026-08-01 to 2026-08-02',
          HttpStatus.CONFLICT,
        ),
      );

      expect(employeeRepo.updateById).toHaveBeenCalledWith(
        mockEmployee._id,
        expect.anything(),
        expect.anything(),
      );
    });

    // -------------------------------------------------------------------------
    // Scenario 2: Concurrent Balance Reservations When Balance is Insufficient
    // -------------------------------------------------------------------------
    it('Scenario 2: should atomically reject reservation when concurrent request depletes available balance', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue({
        ...mockLeaveType,
        allowNegativeBalance: false,
      });
      holidayRepo.findApplicableHolidays.mockResolvedValue([]);
      leaveRequestRepo.findOverlappingRequests.mockResolvedValue([]);
      leaveBalanceRepo.reserveBalance.mockResolvedValue(null);

      await expect(
        service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-06-01',
          endDate: '2026-06-05',
          reason: 'Depleted balance attempt',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Insufficient leave balance for year 2026. Requested: 5 days',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    // -------------------------------------------------------------------------
    // Scenario 3: Double Approval, Rejection, Cancellation or Balance Restoration
    // -------------------------------------------------------------------------
    describe('Scenario 3: Double Execution Protection', () => {
      it('Scenario 3a: should reject duplicate or concurrent second approval with 409 Conflict', async () => {
        leaveRequestRepo.findById.mockResolvedValue({
          ...pendingRequest,
          status: LeaveRequestStatus.PENDING,
        });
        employeeRepo.findByUserId.mockResolvedValue(mockManager);
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveRequestRepo.updateStatus.mockResolvedValue(null);

        await expect(
          service.approveLeave(managerUserId, requestId, {
            remarks: 'Second concurrent approval attempt',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            'Cannot approve leave request: request is not in PENDING status',
            HttpStatus.CONFLICT,
          ),
        );
      });

      it('Scenario 3b: should reject duplicate or concurrent second rejection with 409 Conflict', async () => {
        leaveRequestRepo.findById.mockResolvedValue({
          ...pendingRequest,
          status: LeaveRequestStatus.PENDING,
        });
        employeeRepo.findByUserId.mockResolvedValue(mockManager);
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveRequestRepo.updateStatus.mockResolvedValue(null);

        await expect(
          service.rejectLeave(managerUserId, requestId, {
            reason: 'Second rejection attempt',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.RESOURCE_ALREADY_EXISTS,
            'Cannot reject leave request: request is not in PENDING status',
            HttpStatus.CONFLICT,
          ),
        );
      });

      it('Scenario 3c: should reject double cancellation on an already cancelled request', async () => {
        leaveRequestRepo.findById.mockResolvedValue({
          ...pendingRequest,
          status: LeaveRequestStatus.CANCELLED,
        });
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);

        await expect(
          service.cancelLeave(actorUserId, requestId, {
            reason: 'Repeated cancellation attempt',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            "Cannot cancel leave request in status 'CANCELLED'",
            HttpStatus.BAD_REQUEST,
          ),
        );
      });
    });

    // -------------------------------------------------------------------------
    // Scenario 4: Correct Balance Movement: Pending -> Used, Without Double Deduction
    // -------------------------------------------------------------------------
    it('Scenario 4: should move pending days to used days upon approval without double deduction of available balance', async () => {
      leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockManager);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveRequestRepo.updateStatus.mockResolvedValue({
        ...pendingRequest,
        status: LeaveRequestStatus.APPROVED,
      });

      const balanceAfterApproval: LeaveBalanceLean = {
        ...mockBalance,
        pendingDays: 0,
        usedDays: 2,
        availableBalance: 10,
      };
      leaveBalanceRepo.debitApprovedBalance.mockResolvedValue(
        balanceAfterApproval,
      );

      await service.approveLeave(managerUserId, requestId, {
        remarks: 'Approved with correct balance transition',
      });

      expect(leaveBalanceRepo.debitApprovedBalance).toHaveBeenCalledWith(
        mockEmployee._id,
        leaveTypeId,
        2026,
        2,
        managerUserId,
        expect.anything(),
      );
      expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: LeaveTransactionType.APPROVAL_DEBIT,
          days: -2,
          previousAvailable: 10,
          newAvailable: 10,
        }),
        expect.anything(),
      );
    });

    // -------------------------------------------------------------------------
    // Scenario 5: Cross-Year Balance Reservation and Rollback
    // -------------------------------------------------------------------------
    it('Scenario 5: should abort and rollback cross-year transaction if second year reservation fails', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      holidayRepo.findApplicableHolidays.mockResolvedValue([]);
      leaveRequestRepo.findOverlappingRequests.mockResolvedValue([]);

      leaveBalanceRepo.reserveBalance
        .mockResolvedValueOnce({
          ...mockBalance,
          year: 2026,
          pendingDays: 2,
          availableBalance: 10,
        })
        .mockResolvedValueOnce(null);

      await expect(
        service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-12-30',
          endDate: '2027-01-02',
          reason: 'Cross year trip',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Insufficient leave balance for year 2027. Requested: 2 days',
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveRequestRepo.create).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Scenario 6: Manager Authorization and HR Override Authorization
    // -------------------------------------------------------------------------
    describe('Scenario 6: Authorization Matrix', () => {
      it('Scenario 6a: should allow assigned reporting manager to approve', async () => {
        leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
        employeeRepo.findByUserId.mockResolvedValue(mockManager);
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        leaveRequestRepo.updateStatus.mockResolvedValue({
          ...pendingRequest,
          status: LeaveRequestStatus.APPROVED,
        });
        leaveBalanceRepo.debitApprovedBalance.mockResolvedValue(mockBalance);

        const result = await service.approveLeave(managerUserId, requestId, {
          remarks: 'Manager approval',
        });
        expect(result.status).toBe(LeaveRequestStatus.APPROVED);
      });

      it('Scenario 6b: should block unauthorized peer from approving', async () => {
        const peerEmployee: EmployeeLean = {
          ...mockEmployee,
          _id: new Types.ObjectId(),
          userId: peerUserId,
        };
        leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
        employeeRepo.findByUserId.mockResolvedValue(peerEmployee);
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(false);

        await expect(
          service.approveLeave(peerUserId, requestId, {
            remarks: 'Unauthorized peer attempt',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.FORBIDDEN,
            'Only the assigned reporting manager or authorized HR can approve leave requests',
            HttpStatus.FORBIDDEN,
          ),
        );
      });

      it('Scenario 6c: should strictly prohibit employee self-approval', async () => {
        leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);

        await expect(
          service.approveLeave(actorUserId, requestId, {
            remarks: 'Self approval attempt',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.FORBIDDEN,
            'Employees cannot approve their own leave requests',
            HttpStatus.FORBIDDEN,
          ),
        );
      });

      it('Scenario 6d: should allow HR with LEAVES_APPROVE permission to override and approve', async () => {
        const hrEmployee: EmployeeLean = {
          ...mockEmployee,
          _id: new Types.ObjectId(),
          userId: peerUserId,
          reportingManagerId: null,
        };
        leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
        employeeRepo.findByUserId.mockResolvedValue(hrEmployee);
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        authorizationService.hasPermission.mockResolvedValue(true);
        leaveRequestRepo.updateStatus.mockResolvedValue({
          ...pendingRequest,
          status: LeaveRequestStatus.APPROVED,
        });
        leaveBalanceRepo.debitApprovedBalance.mockResolvedValue(mockBalance);

        const result = await service.approveLeave(peerUserId, requestId, {
          remarks: 'HR authorized override',
        });
        expect(result.status).toBe(LeaveRequestStatus.APPROVED);
      });
    });

    // -------------------------------------------------------------------------
    // Scenario 7: Attendance Synchronization and Cancellation Reconciliation
    // -------------------------------------------------------------------------
    it('Scenario 7: should sync attendance on approval and delete future attendance upon cancellation', async () => {
      leaveRequestRepo.findById.mockResolvedValue(pendingRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockManager);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveRequestRepo.updateStatus.mockResolvedValue({
        ...pendingRequest,
        status: LeaveRequestStatus.APPROVED,
      });
      leaveBalanceRepo.debitApprovedBalance.mockResolvedValue(mockBalance);

      await service.approveLeave(managerUserId, requestId, {
        remarks: 'Approved for attendance sync test',
      });

      expect(attendanceRepo.syncLeaveAttendance).toHaveBeenCalled();

      const futureApprovedRequest: LeaveRequestLean = {
        ...pendingRequest,
        status: LeaveRequestStatus.APPROVED,
        startDate: '2099-01-01',
        endDate: '2099-01-02',
      };
      leaveRequestRepo.findById.mockResolvedValue(futureApprovedRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveRequestRepo.updateStatus.mockResolvedValue({
        ...futureApprovedRequest,
        status: LeaveRequestStatus.CANCELLED,
      });
      leaveBalanceRepo.creditCancelledBalance.mockResolvedValue(mockBalance);

      await service.cancelLeave(actorUserId, requestId, {
        reason: 'Future plan cancellation',
      });

      expect(attendanceRepo.removeFutureLeaveAttendance).toHaveBeenCalledWith(
        requestId,
        expect.any(String),
        expect.anything(),
      );
    });

    // -------------------------------------------------------------------------
    // Scenario 8: Transaction Rollback When Any Critical Database Operation Fails
    // -------------------------------------------------------------------------
    it('Scenario 8: should abort transaction and roll back when ledger creation fails', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
      holidayRepo.findApplicableHolidays.mockResolvedValue([]);
      leaveRequestRepo.findOverlappingRequests.mockResolvedValue([]);
      leaveBalanceRepo.reserveBalance.mockResolvedValue(mockBalance);

      leaveTransactionRepo.create.mockRejectedValue(
        new Error('Primary replica set network timeout on ledger write'),
      );

      await expect(
        service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          reason: 'Network failure rollback test',
        }),
      ).rejects.toThrow('Primary replica set network timeout on ledger write');

      expect(leaveRequestRepo.create).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Scenario 9: Idempotency When Clients Retry Successful Requests
    // -------------------------------------------------------------------------
    it('Scenario 9: should protect against duplicate client retries with idempotent state guards', async () => {
      leaveRequestRepo.findById.mockResolvedValue({
        ...pendingRequest,
        status: LeaveRequestStatus.APPROVED,
      });
      employeeRepo.findByUserId.mockResolvedValue(mockManager);
      employeeRepo.findByUserId.mockResolvedValue(mockManager);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveRequestRepo.updateStatus.mockResolvedValue(null);

      await expect(
        service.approveLeave(managerUserId, requestId, {
          remarks: 'Retried approve button click',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'Cannot approve leave request: request is not in PENDING status',
          HttpStatus.CONFLICT,
        ),
      );
    });

    // -------------------------------------------------------------------------
    // Scenario 10: Past Approved Leave Cancellation Without Silently Changing Historical Attendance
    // -------------------------------------------------------------------------
    it('Scenario 10: should move past approved leave to CANCELLATION_REQUESTED without altering historical attendance', async () => {
      const pastApprovedRequest: LeaveRequestLean = {
        ...pendingRequest,
        status: LeaveRequestStatus.APPROVED,
        startDate: '2020-01-01',
        endDate: '2020-01-02',
      };
      leaveRequestRepo.findById.mockResolvedValue(pastApprovedRequest);
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      leaveRequestRepo.updateStatus.mockResolvedValue({
        ...pastApprovedRequest,
        status: LeaveRequestStatus.CANCELLATION_REQUESTED,
        reconciliationNotes:
          'Awaiting HR attendance reconciliation for past approved leave cancellation.',
      });

      const result = await service.cancelLeave(actorUserId, requestId, {
        reason: 'Attempting to cancel past leave',
      });

      expect(result.status).toBe(LeaveRequestStatus.CANCELLATION_REQUESTED);
      expect(attendanceRepo.removeFutureLeaveAttendance).not.toHaveBeenCalled();
      expect(leaveBalanceRepo.creditCancelledBalance).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Scenario 11: Leave Reservation Ledger Reference Linking
    // -------------------------------------------------------------------------
    describe('Scenario 11: Leave Reservation Ledger Reference Linking', () => {
      it('should generate requestId once and assign it to every RESERVATION ledger entry and LeaveRequest._id', async () => {
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        leaveTypeRepo.findById.mockResolvedValue(mockLeaveType);
        holidayRepo.findApplicableHolidays.mockResolvedValue([]);
        leaveRequestRepo.findOverlappingRequests.mockResolvedValue([]);
        leaveBalanceRepo.reserveBalance.mockResolvedValue(mockBalance);

        leaveRequestRepo.create.mockImplementation((payload) =>
          Promise.resolve({
            ...payload,
            _id: payload._id || requestId,
          } as unknown as LeaveRequestLean),
        );

        const result = await service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-06-08',
          endDate: '2026-06-10',
          reason: 'Summer vacation',
        });

        expect(leaveTransactionRepo.create).toHaveBeenCalledTimes(1);
        const txPayload = leaveTransactionRepo.create.mock.calls[0][0];

        // 1. Verify requestId is generated and assigned as referenceId
        expect(txPayload.referenceId).toBeDefined();
        expect(txPayload.referenceId).not.toBeNull();
        expect(txPayload.referenceId).toBeInstanceOf(Types.ObjectId);
        expect(txPayload.referenceType).toBe('LeaveRequest');
        expect(txPayload.transactionType).toBe(
          LeaveTransactionType.RESERVATION,
        );

        // 2. Verify LeaveRequest was created with the identical _id
        expect(leaveRequestRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            _id: txPayload.referenceId,
          }),
          expect.anything(),
        );
        expect(result._id).toEqual(txPayload.referenceId);
      });

      it('should assign the identical pre-generated requestId to all cross-year yearly RESERVATION ledger entries', async () => {
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          deductWeekends: false,
          deductHolidays: false,
        });
        holidayRepo.findApplicableHolidays.mockResolvedValue([]);
        leaveRequestRepo.findOverlappingRequests.mockResolvedValue([]);
        leaveBalanceRepo.reserveBalance.mockResolvedValue(mockBalance);

        leaveRequestRepo.create.mockImplementation((payload) =>
          Promise.resolve({
            ...payload,
            _id: payload._id || requestId,
          } as unknown as LeaveRequestLean),
        );

        // 2026-12-30 (Wed) to 2027-01-02 (Sat) -> cross-year
        await service.applyLeave(actorUserId, {
          leaveTypeId: leaveTypeId.toString(),
          startDate: '2026-12-30',
          endDate: '2027-01-02',
          reason: 'Cross-year trip',
        });

        expect(leaveTransactionRepo.create).toHaveBeenCalledTimes(2);

        const call2026 = leaveTransactionRepo.create.mock.calls[0][0];
        const call2027 = leaveTransactionRepo.create.mock.calls[1][0];

        expect(call2026.transactionType).toBe(LeaveTransactionType.RESERVATION);
        expect(call2026.year).toBe(2026);
        expect(call2026.referenceId).toBeInstanceOf(Types.ObjectId);
        expect(call2026.referenceType).toBe('LeaveRequest');

        expect(call2027.transactionType).toBe(LeaveTransactionType.RESERVATION);
        expect(call2027.year).toBe(2027);
        expect(call2027.referenceId).toBeInstanceOf(Types.ObjectId);
        expect(call2027.referenceType).toBe('LeaveRequest');

        // Both years must have identical referenceId
        expect(call2026.referenceId).toEqual(call2027.referenceId);

        // And matching the LeaveRequest _id
        expect(leaveRequestRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            _id: call2026.referenceId,
          }),
          expect.anything(),
        );
      });

      it('should abort transaction and not create LeaveRequest when reservation fails on a cross-year split', async () => {
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        leaveTypeRepo.findById.mockResolvedValue({
          ...mockLeaveType,
          deductWeekends: false,
          deductHolidays: false,
        });
        holidayRepo.findApplicableHolidays.mockResolvedValue([]);
        leaveRequestRepo.findOverlappingRequests.mockResolvedValue([]);

        // First year succeeds, second year fails
        leaveBalanceRepo.reserveBalance
          .mockResolvedValueOnce(mockBalance)
          .mockResolvedValueOnce(null);

        await expect(
          service.applyLeave(actorUserId, {
            leaveTypeId: leaveTypeId.toString(),
            startDate: '2026-12-30',
            endDate: '2027-01-02',
            reason: 'Insufficient cross-year balance',
          }),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Insufficient leave balance for year 2027. Requested: 2 days',
            HttpStatus.BAD_REQUEST,
          ),
        );

        // LeaveRequest must not be created
        expect(leaveRequestRepo.create).not.toHaveBeenCalled();
      });
    });
  });
});

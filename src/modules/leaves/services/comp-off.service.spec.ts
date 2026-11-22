/* eslint-disable @typescript-eslint/unbound-method */
import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { CompOffService } from './comp-off.service';
import {
  CompOffRepository,
  CompOffRecordLean,
} from '../repositories/comp-off-record.repository';
import {
  LeaveTypeRepository,
  LeaveTypeLean,
} from '../repositories/leave-type.repository';
import {
  LeaveBalanceRepository,
  LeaveBalanceLean,
} from '../repositories/leave-balance.repository';
import {
  LeaveTransactionRepository,
  LeaveTransactionLean,
} from '../repositories/leave-transaction.repository';
import {
  EmployeeRepository,
  EmployeeLean,
} from '../../employees/repositories/employee.repository';
import {
  AttendanceRepository,
  AttendanceLean,
} from '../../attendance/repositories/attendance.repository';
import {
  HolidayRepository,
  HolidayLean,
} from '../repositories/holiday.repository';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AuthorizationService } from '../../authorization/authorization.service';
import { PermissionKeys } from '../../permissions/constants/permission.constant';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  CompOffStatus,
  HolidayType,
  LeaveTransactionType,
} from '../constants/leaves.constant';
import {
  EmploymentStatus,
  EmploymentType,
} from '../../employees/constants/employee.constant';
import {
  AttendanceStatus,
  WorkMode,
} from '../../attendance/constants/attendance.constant';

describe('CompOffService', () => {
  let service: CompOffService;
  let compOffRepo: jest.Mocked<CompOffRepository>;
  let leaveTypeRepo: jest.Mocked<LeaveTypeRepository>;
  let leaveBalanceRepo: jest.Mocked<LeaveBalanceRepository>;
  let leaveTransactionRepo: jest.Mocked<LeaveTransactionRepository>;
  let employeeRepo: jest.Mocked<EmployeeRepository>;
  let attendanceRepo: jest.Mocked<AttendanceRepository>;
  let holidayRepo: jest.Mocked<HolidayRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let authorizationService: jest.Mocked<AuthorizationService>;

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
  const employeeId = new Types.ObjectId();
  const managerEmployeeId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const compOffId = new Types.ObjectId();
  const compOffLeaveTypeId = new Types.ObjectId();

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
    shiftId: new Types.ObjectId(),
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
    shiftId: new Types.ObjectId(),
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

  const mockCompOffRecord: CompOffRecordLean = {
    _id: compOffId,
    employeeId,
    attendanceDate: '2026-10-25', // Sunday
    overtimeMinutes: 300,
    earnedDays: 1,
    status: CompOffStatus.PENDING,
    expiryDate: '2027-01-23',
    reason: 'Server migration on Sunday',
    deletedAt: null,
    createdBy: actorUserId,
    updatedBy: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCompOffType: LeaveTypeLean = {
    _id: compOffLeaveTypeId,
    name: 'Compensatory Off',
    code: 'COMP_OFF',
    isPaid: true,
    annualAllocation: 0,
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompOffService,
        {
          provide: CompOffRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByEmployeeAndAttendanceDate: jest.fn(),
            findAvailableCompOffs: jest.fn(),
            findList: jest.fn(),
            updateStatus: jest.fn(),
            redeemCompOff: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: LeaveTypeRepository,
          useValue: {
            create: jest.fn(),
            findByCode: jest.fn(),
          },
        },
        {
          provide: LeaveBalanceRepository,
          useValue: {
            upsertAllocation: jest.fn(),
            manualAdjust: jest.fn(),
          },
        },
        {
          provide: LeaveTransactionRepository,
          useValue: {
            create: jest.fn(),
          },
        },
        {
          provide: EmployeeRepository,
          useValue: {
            findByUserId: jest.fn(),
            findById: jest.fn(),
            findByReportingManager: jest.fn(),
          },
        },
        {
          provide: AttendanceRepository,
          useValue: {
            findByEmployeeAndDate: jest.fn(),
          },
        },
        {
          provide: HolidayRepository,
          useValue: {
            findByDateAndBranch: jest.fn().mockResolvedValue(null),
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
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<CompOffService>(CompOffService);
    compOffRepo = module.get(CompOffRepository);
    leaveTypeRepo = module.get(LeaveTypeRepository);
    leaveBalanceRepo = module.get(LeaveBalanceRepository);
    leaveTransactionRepo = module.get(LeaveTransactionRepository);
    employeeRepo = module.get(EmployeeRepository);
    attendanceRepo = module.get(AttendanceRepository);
    holidayRepo = module.get(HolidayRepository);
    auditLogsService = module.get(AuditLogsService);
    authorizationService = module.get(AuthorizationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // 1. CLAIM COMP-OFF
  // ===========================================================================

  describe('claimCompOff', () => {
    it('should allow employee to claim comp-off for overtime worked on a weekend', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      compOffRepo.findByEmployeeAndAttendanceDate.mockResolvedValue(null);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        _id: new Types.ObjectId(),
        employeeId,
        attendanceDate: '2026-10-25',
        status: AttendanceStatus.PRESENT,
        workMode: WorkMode.OFFICE,
        overtimeMinutes: 300,
        totalWorkMinutes: 480,
      } as unknown as AttendanceLean);

      compOffRepo.create.mockResolvedValue(mockCompOffRecord);

      const result = await service.claimCompOff(actorUserId, {
        attendanceDate: '2026-10-25',
        reason: 'Server migration on Sunday',
      });

      expect(result).toBeDefined();
      expect(compOffRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId,
          attendanceDate: '2026-10-25',
          earnedDays: 1,
          status: CompOffStatus.PENDING,
        }),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should allow employee to claim comp-off for working on a public holiday', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      compOffRepo.findByEmployeeAndAttendanceDate.mockResolvedValue(null);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        _id: new Types.ObjectId(),
        employeeId,
        attendanceDate: '2026-08-15',
        status: AttendanceStatus.PRESENT,
        workMode: WorkMode.OFFICE,
        overtimeMinutes: 0,
        totalWorkMinutes: 480,
      } as unknown as AttendanceLean);
      const mockHoliday: HolidayLean = {
        _id: new Types.ObjectId(),
        name: 'Independence Day',
        date: '2026-08-15',
        year: 2026,
        type: HolidayType.PUBLIC,
        branchId,
        description: 'National holiday',
        isActive: true,
        deletedAt: null,
        createdBy: actorUserId,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      holidayRepo.findByDateAndBranch.mockResolvedValue(mockHoliday);

      compOffRepo.create.mockResolvedValue(mockCompOffRecord);

      const result = await service.claimCompOff(actorUserId, {
        attendanceDate: '2026-08-15',
        reason: 'Holiday emergency deployment',
      });

      expect(result).toBeDefined();
      expect(holidayRepo.findByDateAndBranch).toHaveBeenCalledWith(
        '2026-08-15',
        branchId,
      );
    });

    it('should reject duplicate comp-off claim for the same date', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      compOffRepo.findByEmployeeAndAttendanceDate.mockResolvedValue(
        mockCompOffRecord,
      );

      await expect(
        service.claimCompOff(actorUserId, {
          attendanceDate: '2026-10-25',
          reason: 'Duplicate claim attempt',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'Comp-off has already been claimed for attendance date 2026-10-25 with status PENDING',
          HttpStatus.CONFLICT,
        ),
      );
    });

    it('should reject claim if attendance record is absent or on leave', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      compOffRepo.findByEmployeeAndAttendanceDate.mockResolvedValue(null);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        status: AttendanceStatus.ABSENT,
      } as unknown as AttendanceLean);

      await expect(
        service.claimCompOff(actorUserId, {
          attendanceDate: '2026-10-25',
          reason: 'Claim on absent day',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Cannot claim comp-off for date 2026-10-25 where attendance status is ABSENT',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should reject claim if date does not qualify (no overtime and not weekend/holiday)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      compOffRepo.findByEmployeeAndAttendanceDate.mockResolvedValue(null);
      // Tuesday 2026-10-27, no overtime
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        status: AttendanceStatus.PRESENT,
        overtimeMinutes: 0,
        totalWorkMinutes: 480,
      } as unknown as AttendanceLean);

      await expect(
        service.claimCompOff(actorUserId, {
          attendanceDate: '2026-10-27',
          reason: 'Normal working day claim',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Date 2026-10-27 does not qualify for compensatory off (no overtime logged and not a weekend/holiday)',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });
  });

  // ===========================================================================
  // 2. REVIEW COMP-OFF (APPROVAL / REJECTION)
  // ===========================================================================

  describe('reviewCompOff', () => {
    it('should approve comp-off, credit COMP_OFF leave balance, and create transaction', async () => {
      compOffRepo.findById.mockResolvedValue(mockCompOffRecord);
      employeeRepo.findByUserId.mockResolvedValue(mockManager);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      leaveTypeRepo.findByCode.mockResolvedValue(mockCompOffType);

      const initialBalance: LeaveBalanceLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId: compOffLeaveTypeId,
        year: 2026,
        allocatedDays: 0,
        carriedForwardDays: 0,
        creditedDays: 0,
        debitedDays: 0,
        pendingDays: 0,
        usedDays: 0,
        availableBalance: 0,
        deletedAt: null,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedBalance: LeaveBalanceLean = {
        ...initialBalance,
        creditedDays: 1,
        availableBalance: 1,
      };

      leaveBalanceRepo.upsertAllocation.mockResolvedValue(initialBalance);
      leaveBalanceRepo.manualAdjust.mockResolvedValue(updatedBalance);
      const mockTx: LeaveTransactionLean = {
        _id: new Types.ObjectId(),
        employeeId,
        leaveTypeId: compOffLeaveTypeId,
        year: 2026,
        transactionType: LeaveTransactionType.COMP_OFF_CREDIT,
        days: 1,
        previousAvailable: 0,
        newAvailable: 1,
        referenceId: compOffId,
        referenceType: 'CompOffRecord',
        remarks: 'Approved for Sunday deployment',
        actorId: managerUserId,
        createdAt: new Date(),
      };
      leaveTransactionRepo.create.mockResolvedValue(mockTx);

      const approvedRecord: CompOffRecordLean = {
        ...mockCompOffRecord,
        status: CompOffStatus.APPROVED,
        reviewedBy: managerUserId,
        reviewedAt: new Date(),
      };
      compOffRepo.updateStatus.mockResolvedValue(approvedRecord);

      const result = await service.reviewCompOff(managerUserId, compOffId, {
        status: 'APPROVED',
        earnedDays: 1,
        remarks: 'Approved for Sunday deployment',
      });

      expect(result.status).toBe(CompOffStatus.APPROVED);
      expect(authorizationService.hasPermission).toHaveBeenCalledWith(
        managerUserId,
        PermissionKeys.LEAVES_APPROVE,
      );
      expect(leaveBalanceRepo.manualAdjust).toHaveBeenCalledWith(
        employeeId,
        compOffLeaveTypeId,
        2026,
        'CREDIT',
        1,
        managerUserId,
        false,
        expect.anything(),
      );
      expect(leaveTransactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: LeaveTransactionType.COMP_OFF_CREDIT,
          days: 1,
          previousAvailable: 0,
          newAvailable: 1,
          referenceId: compOffId,
          referenceType: 'CompOffRecord',
        }),
        expect.anything(),
      );
    });

    it('should reject comp-off and update status without crediting balance', async () => {
      compOffRepo.findById.mockResolvedValue(mockCompOffRecord);
      employeeRepo.findByUserId.mockResolvedValue(mockManager);
      employeeRepo.findById.mockResolvedValue(mockEmployee);

      const rejectedRecord: CompOffRecordLean = {
        ...mockCompOffRecord,
        status: CompOffStatus.REJECTED,
        reviewedBy: managerUserId,
        reviewedAt: new Date(),
      };
      compOffRepo.updateStatus.mockResolvedValue(rejectedRecord);

      const result = await service.reviewCompOff(managerUserId, compOffId, {
        status: 'REJECTED',
        remarks: 'Work was not pre-authorized',
      });

      expect(result.status).toBe(CompOffStatus.REJECTED);
      expect(leaveBalanceRepo.manualAdjust).not.toHaveBeenCalled();
      expect(leaveTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('should prohibit self-review of comp-off claims', async () => {
      compOffRepo.findById.mockResolvedValue(mockCompOffRecord);
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);

      await expect(
        service.reviewCompOff(actorUserId, compOffId, {
          status: 'APPROVED',
        }),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Employees cannot review their own comp-off claims',
          HttpStatus.FORBIDDEN,
        ),
      );
    });
  });
});

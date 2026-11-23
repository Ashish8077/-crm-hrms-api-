/* eslint-disable @typescript-eslint/unbound-method */
import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Types } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { AttendanceService } from './attendance.service';
import {
  AttendanceLean,
  AttendanceRepository,
} from '../repositories/attendance.repository';
import {
  AttendanceRegularizationLean,
  AttendanceRegularizationRepository,
} from '../repositories/attendance-regularization.repository';
import {
  EmployeeLean,
  EmployeeRepository,
} from '../../employees/repositories/employee.repository';
import {
  EmploymentStatus,
  EmploymentType,
} from '../../employees/constants/employee.constant';
import { ShiftService } from './shift.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AuditAction } from '../../audit-logs/constants/audit-log.constant';
import { AuthorizationService } from '../../authorization/authorization.service';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  AttendanceSource,
  AttendanceStatus,
  BreakType,
  RegularizationStatus,
  RegularizationType,
  WorkMode,
} from '../constants/attendance.constant';
import { ShiftLean } from '../repositories/shift.repository';
import { BranchRepository } from '../../branches/repositories/branch.repository';
import { Branch } from '../../branches/schemas/branch.schema';
import { CheckInDto } from '../dto/check-in.dto';
import { CheckOutDto } from '../dto/check-out.dto';
import { StartBreakDto } from '../dto/start-break.dto';
import { CreateRegularizationDto } from '../dto/create-regularization.dto';
import {
  LeaveRequestLean,
  LeaveRequestRepository,
} from '../../leaves/repositories/leave-request.repository';
import {
  HolidayLean,
  HolidayRepository,
} from '../../leaves/repositories/holiday.repository';
import {
  CompOffStatus,
  HalfDaySession,
  HolidayType,
  LeaveRequestStatus,
  LeaveTransactionType,
} from '../../leaves/constants/leaves.constant';
import { LeavesService } from '../../leaves/services/leaves.service';
import { CompOffService } from '../../leaves/services/comp-off.service';
import { LeaveBalanceRepository } from '../../leaves/repositories/leave-balance.repository';
import { LeaveTransactionRepository } from '../../leaves/repositories/leave-transaction.repository';
import { LeaveTypeRepository } from '../../leaves/repositories/leave-type.repository';
import {
  CompOffRecordLean,
  CompOffRepository,
} from '../../leaves/repositories/comp-off-record.repository';
import { ApprovalTimelineEntry } from '../../leaves/schemas/leave-request.schema';
import { AttendanceCalculationUtil } from '../utils/attendance-calculation.util';

import { WeeklyOffService } from '../../work-schedules/services/weekly-off.service';
import { WeeklyOffConfigRepository } from '../../work-schedules/repositories/weekly-off-config.repository';
import { WeeklyOffConfigLean } from '../../work-schedules/mappers/weekly-off-config.mapper';
import {
  DayOfWeek,
  WeekOccurrence,
} from '../../work-schedules/constants/weekly-off.constant';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let attendanceRepo: jest.Mocked<AttendanceRepository>;
  let regularizationRepo: jest.Mocked<AttendanceRegularizationRepository>;
  let employeeRepo: jest.Mocked<EmployeeRepository>;
  let branchRepo: jest.Mocked<BranchRepository>;
  let shiftService: jest.Mocked<ShiftService>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let authorizationService: jest.Mocked<AuthorizationService>;
  let leaveRequestRepo: jest.Mocked<LeaveRequestRepository>;
  let holidayRepo: jest.Mocked<HolidayRepository>;

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
  const employeeId = new Types.ObjectId();
  const managerUserId = new Types.ObjectId();
  const managerEmployeeId = new Types.ObjectId();
  const shiftId = new Types.ObjectId();
  const attendanceId = new Types.ObjectId();
  const regularizationId = new Types.ObjectId();

  const clientMetadata = { ipAddress: '127.0.0.1', userAgent: 'JestTest/1.0' };

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
    createdBy: actorUserId,
    updatedBy: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockEmployee: EmployeeLean = {
    _id: employeeId,
    userId: actorUserId,
    employeeCode: 'EMP-0001',
    firstName: 'John',
    lastName: 'Doe',
    workEmail: 'john.doe@company.com',
    reportingManagerId: managerEmployeeId,
    shiftId,
    employmentStatus: EmploymentStatus.ACTIVE,
    employmentType: EmploymentType.FULL_TIME,
    dateOfJoining: new Date('2020-01-01T00:00:00.000Z'),
    departmentId: new Types.ObjectId(),
    designationId: new Types.ObjectId(),
    branchId: new Types.ObjectId(),
    teamId: null,
    bankDetails: null,
    emergencyContact: null,
    skills: [],
    certifications: [],
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
  };

  const mockManagerEmployee: EmployeeLean = {
    _id: managerEmployeeId,
    userId: managerUserId,
    employeeCode: 'EMP-0002',
    firstName: 'Jane',
    lastName: 'Manager',
    workEmail: 'jane.manager@company.com',
    reportingManagerId: null,
    shiftId,
    employmentStatus: EmploymentStatus.ACTIVE,
    employmentType: EmploymentType.FULL_TIME,
    dateOfJoining: new Date('2020-01-01T00:00:00.000Z'),
    departmentId: new Types.ObjectId(),
    designationId: new Types.ObjectId(),
    branchId: new Types.ObjectId(),
    teamId: null,
    bankDetails: null,
    emergencyContact: null,
    skills: [],
    certifications: [],
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
  };

  const mockBranch = {
    name: 'Headquarters Tower A',
    latitude: 12.9716,
    longitude: 77.5946,
    radiusMeters: 150,
    allowedIps: ['127.0.0.1', '192.168.1.100'],
    enforceIpCheck: true,
    isActive: true,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
  } as unknown as Branch;

  const mockAttendance: AttendanceLean = {
    _id: attendanceId,
    employeeId,
    attendanceDate: '2026-10-15',
    date: new Date('2026-10-15T00:00:00.000Z'),
    shiftId,
    shiftSnapshot: {
      name: mockShift.name,
      code: mockShift.code,
      startTime: mockShift.startTime,
      endTime: mockShift.endTime,
      isOvernight: mockShift.isOvernight,
      gracePeriodMinutes: mockShift.gracePeriodMinutes,
      minWorkMinutesForFullDay: mockShift.minWorkMinutesForFullDay,
      minWorkMinutesForHalfDay: mockShift.minWorkMinutesForHalfDay,
      overtimeThresholdMinutes: mockShift.overtimeThresholdMinutes,
    },
    checkInTime: new Date('2026-10-15T03:30:00.000Z'),
    checkOutTime: null,
    status: AttendanceStatus.CHECKED_IN,
    workMode: WorkMode.OFFICE,
    breaks: [],
    totalBreakMinutes: 0,
    totalWorkMinutes: 0,
    isLate: false,
    lateMinutes: 0,
    isEarlyDeparture: false,
    earlyDepartureMinutes: 0,
    overtimeMinutes: 0,
    checkInSource: AttendanceSource.WEB,
    checkInIp: '127.0.0.1',
    regularizationId: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRegularization: AttendanceRegularizationLean = {
    _id: regularizationId,
    employeeId,
    attendanceId,
    attendanceDate: '2026-10-15',
    type: RegularizationType.TIME_CORRECTION,
    originalCheckInTime: new Date('2026-10-15T03:30:00.000Z'),
    originalCheckOutTime: null,
    requestedCheckInTime: new Date('2026-10-15T03:30:00.000Z'),
    requestedCheckOutTime: new Date('2026-10-15T12:30:00.000Z'),
    reason: 'Forgot to swipe card',
    status: RegularizationStatus.PENDING,
    appliedAt: new Date(),
    reviewedBy: null,
    reviewedAt: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        {
          provide: AttendanceRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByEmployeeAndDate: jest.fn(),
            findActiveSessionByEmployee: jest.fn(),
            findCalendar: jest.fn(),
            findList: jest.fn(),
            updateById: jest.fn(),
            updateCheckInForExistingLeave: jest.fn(),
            checkOutSession: jest.fn(),
            startBreak: jest.fn(),
            endActiveBreak: jest.fn(),
            getMonthlySummary: jest.fn(),
            removeFutureLeaveAttendance: jest.fn(),
          },
        },
        {
          provide: AttendanceRegularizationRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findPendingByEmployeeAndDate: jest.fn(),
            findList: jest.fn(),
            updateStatus: jest.fn(),
          },
        },
        {
          provide: EmployeeRepository,
          useValue: {
            findById: jest.fn(),
            findByUserId: jest.fn(),
          },
        },
        {
          provide: BranchRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: ShiftService,
          useValue: {
            resolveShift: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            createAuditLog: jest.fn(),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            hasPermission: jest.fn(),
          },
        },
        {
          provide: LeaveRequestRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue(null),
            findOverlappingRequests: jest.fn().mockResolvedValue([]),
            updateStatus: jest.fn(),
          },
        },
        {
          provide: HolidayRepository,
          useValue: {
            findApplicableHolidays: jest.fn().mockResolvedValue([]),
            findByDateAndBranch: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
    attendanceRepo = module.get(AttendanceRepository);
    regularizationRepo = module.get(AttendanceRegularizationRepository);
    employeeRepo = module.get(EmployeeRepository);
    branchRepo = module.get(BranchRepository);
    branchRepo.findById.mockResolvedValue(mockBranch);
    shiftService = module.get(ShiftService);
    auditLogsService = module.get(AuditLogsService);
    authorizationService = module.get(AuthorizationService);
    leaveRequestRepo = module.get(LeaveRequestRepository);
    holidayRepo = module.get(HolidayRepository);
  });

  describe('checkIn', () => {
    it('should throw RESOURCE_NOT_FOUND if user has no employee record', async () => {
      employeeRepo.findByUserId.mockResolvedValue(null);

      await expect(
        service.checkIn(actorUserId, {}, clientMetadata),
      ).rejects.toThrow(AppError);
    });

    it('TC-02: should throw RESOURCE_ALREADY_EXISTS (409 Conflict) if already checked in today', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(mockAttendance);

      await expect(
        service.checkIn(actorUserId, {}, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });

      expect(attendanceRepo.create).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });

    it('should catch MongoDB duplicate key error (11000) on atomic insert and return 409 Conflict during concurrent check-in race', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
      shiftService.resolveShift.mockResolvedValue(mockShift);

      const mongoDuplicateError = new Error(
        'E11000 duplicate key error collection: attendances index: uq_attendance_emp_date dup key: { employeeId: ObjectId("..."), attendanceDate: "2026-10-23" }',
      );
      (mongoDuplicateError as unknown as { code: number }).code = 11000;
      attendanceRepo.create.mockRejectedValue(mongoDuplicateError);

      await expect(
        service.checkIn(actorUserId, {}, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('TC-02: should throw RESOURCE_ALREADY_EXISTS (409 Conflict) if an active session is already in progress', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      attendanceRepo.findActiveSessionByEmployee.mockResolvedValue({
        ...mockAttendance,
        attendanceDate: '2026-10-15',
        status: AttendanceStatus.CHECKED_IN,
      });

      await expect(
        service.checkIn(actorUserId, {}, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });

      expect(attendanceRepo.create).not.toHaveBeenCalled();
    });

    it('TC-03: should reject check-in when employee has already completed attendance (checked out) for the day', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.PRESENT,
        checkInTime: new Date('2026-10-15T03:30:00.000Z'),
        checkOutTime: new Date('2026-10-15T12:30:00.000Z'),
      });

      await expect(
        service.checkIn(actorUserId, {}, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });

      expect(attendanceRepo.create).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });

    it('TC-01: should successfully record check-in, set status to CHECKED_IN, verify no checkout time and no active break', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
      shiftService.resolveShift.mockResolvedValue(mockShift);
      attendanceRepo.create.mockResolvedValue(mockAttendance);

      const result = await service.checkIn(
        actorUserId,
        { workMode: WorkMode.OFFICE },
        clientMetadata,
      );

      expect(attendanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: mockEmployee._id,
          status: AttendanceStatus.CHECKED_IN,
          checkOutTime: null,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
        }),
        expect.anything(),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      expect(result.status).toBe(AttendanceStatus.CHECKED_IN);
      expect(result.checkOutTime).toBeNull();
      expect(result.breaks).toEqual([]);
    });

    it('TC-05: should reject check-in with 422 Unprocessable Entity and prevent partial attendance record when no valid shift is found', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
      shiftService.resolveShift.mockRejectedValue(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'No applicable shift found for employee attendance. Please assign a shift or configure an active company default shift.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
      );

      await expect(
        service.checkIn(actorUserId, {}, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      });

      expect(attendanceRepo.create).not.toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
    });

    it('should completely ignore client-supplied shiftId in CheckInDto during employee self-punch to prevent dodging late marks', async () => {
      const maliciousEveningShiftId = new Types.ObjectId();
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
      shiftService.resolveShift.mockResolvedValue(mockShift);
      attendanceRepo.create.mockResolvedValue(mockAttendance);

      await service.checkIn(
        actorUserId,
        {
          shiftId: maliciousEveningShiftId.toString(),
        },
        clientMetadata,
      );

      // Verify resolveShift was called with employee.shiftId, and the client shiftId was IGNORED (null passed)
      expect(shiftService.resolveShift).toHaveBeenCalledWith(
        mockEmployee.shiftId,
        null,
        expect.objectContaining({
          employeeId: mockEmployee._id,
          isAdminOverride: false,
        }),
      );
    });

    it('should fall back to company default shift when employee has no assigned shiftId on profile (Day 1 onboarding)', async () => {
      const newHireEmployee = { ...mockEmployee, shiftId: null };
      employeeRepo.findByUserId.mockResolvedValue(newHireEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
      shiftService.resolveShift.mockResolvedValue(mockShift);
      attendanceRepo.create.mockResolvedValue(mockAttendance);

      const result = await service.checkIn(actorUserId, {}, clientMetadata);

      expect(shiftService.resolveShift).toHaveBeenCalledWith(
        null,
        null,
        expect.objectContaining({
          employeeId: newHireEmployee._id,
          isAdminOverride: false,
        }),
      );
      expect(result.status).toBe(AttendanceStatus.CHECKED_IN);
    });

    it('TC-07: should determine attendanceDate from configured Asia/Kolkata timezone at midnight boundary rather than server UTC date', async () => {
      // Mock system time to 2026-10-21T18:30:00.000Z (00:00:00 IST on 2026-10-22)
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-21T18:30:00.000Z'));

      try {
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
        shiftService.resolveShift.mockResolvedValue(mockShift);
        attendanceRepo.create.mockResolvedValue(mockAttendance);

        await service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        // findByEmployeeAndDate must be queried with '2026-10-22', NOT '2026-10-21'
        expect(attendanceRepo.findByEmployeeAndDate).toHaveBeenCalledWith(
          mockEmployee._id,
          '2026-10-22',
        );

        // create must be persisted with attendanceDate: '2026-10-22'
        expect(attendanceRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            attendanceDate: '2026-10-22',
          }),
          expect.anything(),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-08: should handle concurrent race condition and translate MongoDB duplicate key error (code 11000) to CONFLICT', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
      shiftService.resolveShift.mockResolvedValue(mockShift);

      // Simulate concurrent insert winning the race: MongoDB unique index uq_attendance_emp_date throws code 11000
      const duplicateKeyError = new Error(
        'E11000 duplicate key error collection: crm.attendances index: uq_attendance_emp_date dup key: { employeeId: ObjectId(...), attendanceDate: "2026-10-15" }',
      );
      (duplicateKeyError as unknown as { code: number }).code = 11000;
      attendanceRepo.create.mockRejectedValue(duplicateKeyError);

      await expect(
        service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });

      // Session must be ended cleanly
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('TC-09: should prevent duplicate attendance and return CONFLICT on client retry after lost response', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      shiftService.resolveShift.mockResolvedValue(mockShift);

      // In-memory record simulating MongoDB state
      let persistedRecord: AttendanceLean | null = null;
      attendanceRepo.findByEmployeeAndDate.mockImplementation(() =>
        Promise.resolve(persistedRecord),
      );
      attendanceRepo.findActiveSessionByEmployee.mockImplementation(() =>
        Promise.resolve(persistedRecord),
      );
      attendanceRepo.create.mockImplementation((data) => {
        persistedRecord = {
          ...mockAttendance,
          ...data,
          _id: new Types.ObjectId(),
        };
        return Promise.resolve(persistedRecord);
      });

      // 1. Initial check-in: succeeds on server (simulating network timeout / lost response on client)
      const firstResponse = await service.checkIn(
        actorUserId,
        { workMode: WorkMode.OFFICE },
        clientMetadata,
      );
      expect(firstResponse.status).toBe(AttendanceStatus.CHECKED_IN);
      expect(attendanceRepo.create).toHaveBeenCalledTimes(1);
      expect(persistedRecord).not.toBeNull();

      // 2. Client retries request with identical payload
      await expect(
        service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });

      // Verify no duplicate record was created (create call count remains exactly 1)
      expect(attendanceRepo.create).toHaveBeenCalledTimes(1);

      // 3. Client recovers current state via getTodayStatus
      const todayState = await service.getTodayStatus(actorUserId);
      expect(todayState.isCheckedIn).toBe(true);
      expect(todayState.attendance?.id).toBe(
        (persistedRecord as unknown as AttendanceLean)._id.toString(),
      );
    });

    describe('TC-11: User attempts another employee attendance (session derivation and employee isolation)', () => {
      const victimUserId = new Types.ObjectId();
      const victimEmployeeId = new Types.ObjectId();
      const victimAttendanceId = new Types.ObjectId();

      const mockVictimEmployee: EmployeeLean = {
        ...mockEmployee,
        _id: victimEmployeeId,
        userId: victimUserId,
        employeeCode: 'EMP-0999',
        firstName: 'Victim',
        lastName: 'Employee',
        workEmail: 'victim.employee@company.com',
      };

      const mockVictimAttendance: AttendanceLean = {
        ...mockAttendance,
        _id: victimAttendanceId,
        employeeId: victimEmployeeId,
        status: AttendanceStatus.CHECKED_IN,
      };

      it('should derive employee identity solely from authenticated session and ignore manipulated employeeId in check-in payload', async () => {
        employeeRepo.findByUserId.mockImplementation((uId) => {
          const idStr = typeof uId === 'string' ? uId : uId.toString();
          if (idStr === actorUserId.toString())
            return Promise.resolve(mockEmployee);
          if (idStr === victimUserId.toString()) {
            return Promise.resolve(mockVictimEmployee);
          }
          return Promise.resolve(null);
        });
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
        shiftService.resolveShift.mockResolvedValue(mockShift);
        attendanceRepo.create.mockResolvedValue(mockAttendance);

        // Attacker injects another employee's ID into the payload
        const maliciousPayload = {
          workMode: WorkMode.OFFICE,
          employeeId: victimEmployeeId.toString(),
        } as unknown as CheckInDto;

        const result = await service.checkIn(
          actorUserId,
          maliciousPayload,
          clientMetadata,
        );

        // 1. Employee lookup must be for authenticated actor, never victim
        expect(employeeRepo.findByUserId).toHaveBeenCalledWith(actorUserId);
        expect(employeeRepo.findByUserId).not.toHaveBeenCalledWith(
          victimUserId,
        );

        // 2. Attendance repository queries must use authenticated actor's employeeId
        expect(attendanceRepo.findByEmployeeAndDate).toHaveBeenCalledWith(
          mockEmployee._id,
          expect.any(String),
        );
        expect(attendanceRepo.findByEmployeeAndDate).not.toHaveBeenCalledWith(
          victimEmployeeId,
          expect.any(String),
        );

        // 3. Persisted record must strictly belong to authenticated actor
        expect(attendanceRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: mockEmployee._id,
          }),
          expect.anything(),
        );
        expect(attendanceRepo.create).not.toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: victimEmployeeId,
          }),
          expect.anything(),
        );

        // 4. Injected employeeId must be ignored and not assigned to response
        expect(result.employeeId).toBe(mockEmployee._id.toString());
        expect(result.employeeId).not.toBe(victimEmployeeId.toString());

        // 5. Audit log must record the authenticated actor
        expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: actorUserId,
          }),
          expect.anything(),
        );
      });

      it('should guarantee another employee existing attendance record remains unmodified during check-in attempt', async () => {
        employeeRepo.findByUserId.mockImplementation((uId) => {
          const idStr = typeof uId === 'string' ? uId : uId.toString();
          if (idStr === actorUserId.toString())
            return Promise.resolve(mockEmployee);
          if (idStr === victimUserId.toString()) {
            return Promise.resolve(mockVictimEmployee);
          }
          return Promise.resolve(null);
        });

        // Victim has an active session; attacker does not
        attendanceRepo.findByEmployeeAndDate.mockImplementation((empId) => {
          const idStr = typeof empId === 'string' ? empId : empId.toString();
          return Promise.resolve(
            idStr === victimEmployeeId.toString() ? mockVictimAttendance : null,
          );
        });
        attendanceRepo.findActiveSessionByEmployee.mockImplementation(
          (empId) => {
            const idStr = typeof empId === 'string' ? empId : empId.toString();
            return Promise.resolve(
              idStr === victimEmployeeId.toString()
                ? mockVictimAttendance
                : null,
            );
          },
        );
        shiftService.resolveShift.mockResolvedValue(mockShift);
        attendanceRepo.create.mockResolvedValue(mockAttendance);

        const maliciousPayload = {
          workMode: WorkMode.OFFICE,
          employeeId: victimEmployeeId.toString(),
        } as unknown as CheckInDto;

        const result = await service.checkIn(
          actorUserId,
          maliciousPayload,
          clientMetadata,
        );

        expect(result.status).toBe(AttendanceStatus.CHECKED_IN);

        // Crucial invariant: victim's existing record is never modified or closed
        expect(attendanceRepo.updateById).not.toHaveBeenCalledWith(
          victimAttendanceId,
          expect.anything(),
          expect.anything(),
        );
        expect(attendanceRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: mockEmployee._id,
          }),
          expect.anything(),
        );
      });

      it('should reject check-in with RESOURCE_NOT_FOUND when authenticated user has no linked employee profile', async () => {
        const rogueUserId = new Types.ObjectId();
        employeeRepo.findByUserId.mockResolvedValue(null);

        const maliciousPayload = {
          workMode: WorkMode.OFFICE,
          employeeId: victimEmployeeId.toString(),
        } as unknown as CheckInDto;

        await expect(
          service.checkIn(rogueUserId, maliciousPayload, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.RESOURCE_NOT_FOUND,
          statusCode: HttpStatus.NOT_FOUND,
        });

        // No attendance record created and victim record untouched
        expect(attendanceRepo.create).not.toHaveBeenCalled();
        expect(attendanceRepo.findByEmployeeAndDate).not.toHaveBeenCalledWith(
          victimEmployeeId,
          expect.any(String),
        );
        expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
      });

      it('should reject cross-employee check-out attempt and never mutate target employee active session', async () => {
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        // Attacker has no active check-in today
        attendanceRepo.findByEmployeeAndDate.mockImplementation((empId) => {
          const idStr = typeof empId === 'string' ? empId : empId.toString();
          return Promise.resolve(
            idStr === victimEmployeeId.toString() ? mockVictimAttendance : null,
          );
        });
        attendanceRepo.findActiveSessionByEmployee.mockImplementation(
          (empId) => {
            const idStr = typeof empId === 'string' ? empId : empId.toString();
            return Promise.resolve(
              idStr === victimEmployeeId.toString()
                ? mockVictimAttendance
                : null,
            );
          },
        );

        const maliciousPayload = {
          employeeId: victimEmployeeId.toString(),
        } as unknown as CheckOutDto;

        await expect(
          service.checkOut(actorUserId, maliciousPayload, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.VALIDATION_ERROR,
          statusCode: HttpStatus.BAD_REQUEST,
        });

        // Victim's active session is never updated to checked-out
        expect(attendanceRepo.updateById).not.toHaveBeenCalled();
      });

      it('should reject cross-employee startBreak attempt and preserve target employee active session', async () => {
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        // Attacker is not checked in
        attendanceRepo.findByEmployeeAndDate.mockImplementation((empId) => {
          const idStr = typeof empId === 'string' ? empId : empId.toString();
          return Promise.resolve(
            idStr === victimEmployeeId.toString() ? mockVictimAttendance : null,
          );
        });
        attendanceRepo.findActiveSessionByEmployee.mockImplementation(
          (empId) => {
            const idStr = typeof empId === 'string' ? empId : empId.toString();
            return Promise.resolve(
              idStr === victimEmployeeId.toString()
                ? mockVictimAttendance
                : null,
            );
          },
        );

        const maliciousPayload = {
          type: BreakType.LUNCH,
          employeeId: victimEmployeeId.toString(),
        } as unknown as StartBreakDto;

        await expect(
          service.startBreak(actorUserId, maliciousPayload, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.VALIDATION_ERROR,
          statusCode: HttpStatus.BAD_REQUEST,
        });

        expect(attendanceRepo.startBreak).not.toHaveBeenCalled();
      });

      it('should bind regularization requests strictly to authenticated employee, ignoring injected employeeId', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
        try {
          employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
          regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(
            null,
          );
          attendanceRepo.findByEmployeeAndDate.mockResolvedValue(
            mockAttendance,
          );
          regularizationRepo.create.mockResolvedValue(mockRegularization);

          const maliciousPayload = {
            attendanceDate: '2026-10-15',
            requestedCheckInTime: '2026-10-15T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-15T12:30:00.000Z',
            reason: 'Biometric device offline',
            employeeId: victimEmployeeId.toString(),
          } as unknown as CreateRegularizationDto;

          await service.createRegularization(
            actorUserId,
            maliciousPayload,
            clientMetadata,
          );

          // Verification: regularization is created for mockEmployee._id, NEVER victimEmployeeId
          expect(regularizationRepo.create).toHaveBeenCalledWith(
            expect.objectContaining({
              employeeId: mockEmployee._id,
            }),
            expect.anything(),
          );
          expect(regularizationRepo.create).not.toHaveBeenCalledWith(
            expect.objectContaining({
              employeeId: victimEmployeeId,
            }),
            expect.anything(),
          );
        } finally {
          jest.useRealTimers();
        }
      });
    });

    describe('database failure and transaction atomicity during check-in', () => {
      beforeEach(() => {
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
        shiftService.resolveShift.mockResolvedValue(mockShift);
        attendanceRepo.create.mockResolvedValue(mockAttendance);
        auditLogsService.createAuditLog.mockResolvedValue(undefined);
        mockSession.endSession.mockClear();
        mockSession.withTransaction.mockClear();
        mockConnection.startSession.mockClear();
      });

      it('should abort transaction, prevent audit log creation, and cleanup session when attendanceRepo.create fails', async () => {
        const dbError = new Error(
          'MongoServerError: connection timeout on primary write',
        );
        attendanceRepo.create.mockRejectedValue(dbError);

        await expect(
          service.checkIn(
            actorUserId,
            { workMode: WorkMode.OFFICE },
            clientMetadata,
          ),
        ).rejects.toThrow(dbError);

        // Audit log must not be created when record creation fails
        expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();

        // Transaction session must be safely terminated in finally block
        expect(mockConnection.startSession).toHaveBeenCalledTimes(1);
        expect(mockSession.withTransaction).toHaveBeenCalledTimes(1);
        expect(mockSession.endSession).toHaveBeenCalledTimes(1);
      });

      it('should abort transaction, rollback attendance creation, and cleanup session when audit log creation fails', async () => {
        const auditDbError = new Error(
          'MongoServerError: failed to write audit log document',
        );
        auditLogsService.createAuditLog.mockRejectedValue(auditDbError);

        let transactionAborted = false;
        let transactionCommitted = false;
        mockSession.withTransaction.mockImplementationOnce(
          async (cb: (session: unknown) => Promise<unknown>) => {
            try {
              await cb(mockSession);
              transactionCommitted = true;
            } catch (err) {
              transactionAborted = true;
              throw err;
            }
          },
        );

        await expect(
          service.checkIn(
            actorUserId,
            { workMode: WorkMode.OFFICE },
            clientMetadata,
          ),
        ).rejects.toThrow(auditDbError);

        // Production invariant: both writes share the exact same ClientSession
        expect(attendanceRepo.create).toHaveBeenCalledWith(
          expect.anything(),
          mockSession,
        );
        expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
          expect.anything(),
          mockSession,
        );

        // Transaction rollback behavior
        expect(transactionAborted).toBe(true);
        expect(transactionCommitted).toBe(false);

        // Session must be cleanly ended, leaving no unclosed cursors or connections
        expect(mockSession.endSession).toHaveBeenCalledTimes(1);
      });

      it('should execute attendance creation, shift snapshot, and audit event within the exact same database transaction session', async () => {
        const result = await service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        expect(result.status).toBe(AttendanceStatus.CHECKED_IN);

        // Verify session lifecycle
        expect(mockConnection.startSession).toHaveBeenCalledTimes(1);
        expect(mockSession.withTransaction).toHaveBeenCalledTimes(1);

        // Verify the exact same session instance is passed to all transactional writes
        expect(attendanceRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: mockEmployee._id,
          }),
          mockSession,
        );
        const createCallArgs = attendanceRepo.create.mock.calls[0];
        expect(createCallArgs[0].shiftSnapshot?.name).toBe(mockShift.name);
        expect(createCallArgs[0].shiftSnapshot?.code).toBe(mockShift.code);

        expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: actorUserId,
            targetId: mockAttendance._id,
          }),
          mockSession,
        );

        expect(mockSession.endSession).toHaveBeenCalledTimes(1);
      });

      it('should reject check-in and prevent any transaction or mutations when database connection startSession fails', async () => {
        const connError = new Error(
          'MongoNetworkError: failed to connect to replica set primary',
        );
        mockConnection.startSession.mockRejectedValueOnce(connError);

        await expect(
          service.checkIn(
            actorUserId,
            { workMode: WorkMode.OFFICE },
            clientMetadata,
          ),
        ).rejects.toThrow(connError);

        expect(mockSession.withTransaction).not.toHaveBeenCalled();
        expect(attendanceRepo.create).not.toHaveBeenCalled();
        expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
        expect(mockSession.endSession).not.toHaveBeenCalled();
      });

      it('should reject check-in and prevent transaction creation when pre-check query throws a database failure', async () => {
        const readDbError = new Error(
          'MongoNetworkTimeoutException: read replica timed out',
        );
        attendanceRepo.findByEmployeeAndDate.mockRejectedValue(readDbError);

        await expect(
          service.checkIn(
            actorUserId,
            { workMode: WorkMode.OFFICE },
            clientMetadata,
          ),
        ).rejects.toThrow(readDbError);

        // No session or writes attempted
        expect(mockConnection.startSession).not.toHaveBeenCalled();
        expect(attendanceRepo.create).not.toHaveBeenCalled();
        expect(auditLogsService.createAuditLog).not.toHaveBeenCalled();
      });
    });

    describe('employment eligibility', () => {
      beforeEach(() => {
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
        shiftService.resolveShift.mockResolvedValue(mockShift);
        attendanceRepo.create.mockResolvedValue(mockAttendance);
      });

      it('should allow check-in for PROBATION employee', async () => {
        employeeRepo.findByUserId.mockResolvedValue({
          ...mockEmployee,
          employmentStatus: EmploymentStatus.PROBATION,
        });

        const result = await service.checkIn(actorUserId, {}, clientMetadata);
        expect(result.status).toBe(AttendanceStatus.CHECKED_IN);
      });

      it('should allow check-in for NOTICE_PERIOD employee before last working date', async () => {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        employeeRepo.findByUserId.mockResolvedValue({
          ...mockEmployee,
          employmentStatus: EmploymentStatus.NOTICE_PERIOD,
          lastWorkingDate: tomorrow,
        } as unknown as EmployeeLean);

        const result = await service.checkIn(actorUserId, {}, clientMetadata);
        expect(result.status).toBe(AttendanceStatus.CHECKED_IN);
      });

      it('should throw FORBIDDEN for NOTICE_PERIOD employee after last working date', async () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        employeeRepo.findByUserId.mockResolvedValue({
          ...mockEmployee,
          employmentStatus: EmploymentStatus.NOTICE_PERIOD,
          lastWorkingDate: yesterday,
        } as unknown as EmployeeLean);

        await expect(
          service.checkIn(actorUserId, {}, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
        });
      });

      it('should throw FORBIDDEN for TERMINATED employee', async () => {
        employeeRepo.findByUserId.mockResolvedValue({
          ...mockEmployee,
          employmentStatus: EmploymentStatus.TERMINATED,
        });

        await expect(
          service.checkIn(actorUserId, {}, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
        });
      });

      it('should throw FORBIDDEN for RESIGNED employee', async () => {
        employeeRepo.findByUserId.mockResolvedValue({
          ...mockEmployee,
          employmentStatus: EmploymentStatus.RESIGNED,
        });

        await expect(
          service.checkIn(actorUserId, {}, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
        });
      });

      it('should throw FORBIDDEN for employee with future joining date', async () => {
        const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        employeeRepo.findByUserId.mockResolvedValue({
          ...mockEmployee,
          dateOfJoining: nextWeek,
        });

        await expect(
          service.checkIn(actorUserId, {}, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
        });
      });

      it('should throw RESOURCE_NOT_FOUND if employee profile is soft-deleted (repo returns null)', async () => {
        employeeRepo.findByUserId.mockResolvedValue(null);

        await expect(
          service.checkIn(actorUserId, {}, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.RESOURCE_NOT_FOUND,
        });
      });

      it('should also enforce eligibility on checkOut when employee is TERMINATED', async () => {
        employeeRepo.findByUserId.mockResolvedValue({
          ...mockEmployee,
          employmentStatus: EmploymentStatus.TERMINATED,
        });

        await expect(
          service.checkOut(actorUserId, {}, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
        });
      });

      it('should also enforce eligibility on startBreak when employee is RESIGNED', async () => {
        employeeRepo.findByUserId.mockResolvedValue({
          ...mockEmployee,
          employmentStatus: EmploymentStatus.RESIGNED,
        });

        await expect(
          service.startBreak(actorUserId, {}, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
        });
      });
    });

    describe('production payload security & policy audit', () => {
      beforeEach(() => {
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
        shiftService.resolveShift.mockResolvedValue(mockShift);
        branchRepo.findById.mockResolvedValue(mockBranch);
        attendanceRepo.create.mockImplementation((data) =>
          Promise.resolve({
            ...mockAttendance,
            ...data,
            _id: new Types.ObjectId(),
          } as AttendanceLean),
        );
      });

      it('should allow check-in within branch geofence (<150m) and populate isWithinGeofence: true and distance', async () => {
        branchRepo.findById.mockResolvedValue(mockBranch);

        // Near point ~70m away
        const dto: CheckInDto = {
          source: AttendanceSource.MOBILE,
          location: {
            latitude: 12.9721,
            longitude: 77.595,
            accuracyMeters: 10,
          },
        };

        const result = await service.checkIn(actorUserId, dto, clientMetadata);
        expect(result.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(result.checkInLocation?.isWithinGeofence).toBe(true);
        expect(result.checkInLocation?.isGeofenceVerified).toBe(true);
        expect(result.checkInLocation?.isIpVerified).toBe(true);
        expect(typeof result.checkInLocation?.distanceMeters).toBe('number');
      });

      it('should reject check-in when coordinates are outside the 150m geofence radius', async () => {
        branchRepo.findById.mockResolvedValue(mockBranch);

        // Point ~500m away
        const dto: CheckInDto = {
          source: AttendanceSource.MOBILE,
          location: {
            latitude: 12.976,
            longitude: 77.5946,
          },
        };

        await expect(
          service.checkIn(actorUserId, dto, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
          statusCode: HttpStatus.FORBIDDEN,
        });
      });

      it('should reject weak GPS accuracy (>100m) to prevent cell-tower jumps and spoofing', async () => {
        branchRepo.findById.mockResolvedValue(mockBranch);

        const dto: CheckInDto = {
          source: AttendanceSource.MOBILE,
          location: {
            latitude: 12.9721,
            longitude: 77.595,
            accuracyMeters: 180, // Weak accuracy
          },
        };

        await expect(
          service.checkIn(actorUserId, dto, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.VALIDATION_ERROR,
          statusCode: HttpStatus.BAD_REQUEST,
        });
      });

      it('should never trust client-provided address string when coordinates are outside geofence', async () => {
        branchRepo.findById.mockResolvedValue(mockBranch);

        // Employee sitting at home passes fake branch address text with home GPS coordinates
        const dto: CheckInDto = {
          source: AttendanceSource.MOBILE,
          location: {
            latitude: 12.976,
            longitude: 77.5946,
            address: 'Headquarters Tower A, President Suite',
          },
        };

        await expect(
          service.checkIn(actorUserId, dto, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
          statusCode: HttpStatus.FORBIDDEN,
        });
      });

      it('should allow WEB check-in without GPS when client IP matches branch office Wi-Fi static IP (avoids Desktop GPS trap)', async () => {
        branchRepo.findById.mockResolvedValue(mockBranch);

        const dto: CheckInDto = {
          source: AttendanceSource.WEB,
        };
        const officeMetadata = {
          ipAddress: '192.168.1.100',
          userAgent: 'Desktop/Browser',
        };

        const result = await service.checkIn(actorUserId, dto, officeMetadata);
        expect(result.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(result.checkInSource).toBe(AttendanceSource.WEB);
        expect(result.checkInLocation?.isIpVerified).toBe(true);
        expect(result.checkInLocation?.isGeofenceVerified).toBe(false);
        expect(attendanceRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            checkInSource: AttendanceSource.WEB,
            checkInIp: '192.168.1.100',
          }),
          expect.anything(),
        );
      });

      it('should reject WEB check-in without GPS when client IP does not match branch office static IP', async () => {
        branchRepo.findById.mockResolvedValue(mockBranch);

        // Rogue employee sends source: WEB from outside office Wi-Fi without GPS
        const dto: CheckInDto = {
          source: AttendanceSource.WEB,
        };
        const externalMetadata = {
          ipAddress: '203.0.113.199',
          userAgent: 'Desktop/Browser',
        };

        await expect(
          service.checkIn(actorUserId, dto, externalMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
          statusCode: HttpStatus.FORBIDDEN,
        });
      });

      it('should detect mobile User-Agent and force GPS coordinates even if client specifies source: WEB (spoofing prevention)', async () => {
        branchRepo.findById.mockResolvedValue(mockBranch);

        // Rogue employee on mobile fakes source: WEB without GPS
        const dto: CheckInDto = {
          source: AttendanceSource.WEB,
        };
        const mobileMetadata = {
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        };

        await expect(
          service.checkIn(actorUserId, dto, mobileMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.VALIDATION_ERROR,
          statusCode: HttpStatus.BAD_REQUEST,
        });
      });

      it('should strictly reject MOBILE check-in when GPS coordinates are omitted', async () => {
        branchRepo.findById.mockResolvedValue(mockBranch);

        const dto: CheckInDto = {
          source: AttendanceSource.MOBILE,
        };

        await expect(
          service.checkIn(actorUserId, dto, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.VALIDATION_ERROR,
          statusCode: HttpStatus.BAD_REQUEST,
        });
      });

      it('should reject WFH or ON_DUTY workMode with 403 FORBIDDEN when employee isRemoteAllowed is false', async () => {
        employeeRepo.findByUserId.mockResolvedValue({
          ...mockEmployee,
          isRemoteAllowed: false,
        });

        const dto: CheckInDto = {
          workMode: WorkMode.WORK_FROM_HOME,
        };

        await expect(
          service.checkIn(actorUserId, dto, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
          statusCode: HttpStatus.FORBIDDEN,
        });
      });

      it('should allow WFH workMode when employee isRemoteAllowed is true, bypassing branch geofence', async () => {
        employeeRepo.findByUserId.mockResolvedValue({
          ...mockEmployee,
          isRemoteAllowed: true,
        });
        branchRepo.findById.mockResolvedValue(mockBranch);

        const dto: CheckInDto = {
          workMode: WorkMode.WORK_FROM_HOME,
        };

        const result = await service.checkIn(actorUserId, dto, clientMetadata);
        expect(result.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(result.workMode).toBe(WorkMode.WORK_FROM_HOME);
        expect(result.checkInLocation?.isGeofenceVerified).toBe(false);
      });

      it('should sanitize HTML tags from notes and trim whitespace', async () => {
        const dto: CheckInDto = {
          notes: '   <script>alert("hack")</script>Client meeting at 10 AM   ',
        };

        const result = await service.checkIn(actorUserId, dto, clientMetadata);
        expect(result.checkInNotes).toBe(
          'alert("hack")Client meeting at 10 AM',
        );
      });
    });
  });

  describe('checkOut', () => {
    it('should throw VALIDATION_ERROR if no check-in exists for today', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

      await expect(
        service.checkOut(actorUserId, {}, clientMetadata),
      ).rejects.toThrow(AppError);
    });

    it('should throw VALIDATION_ERROR if already checked out (status PRESENT)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.PRESENT,
      });

      await expect(
        service.checkOut(actorUserId, {}, clientMetadata),
      ).rejects.toThrow(AppError);
    });

    it('should reject check-out with 400 Bad Request if attempted within 60 seconds of check-in (cooldown guard)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        checkInTime: new Date(Date.now() - 30 * 1000), // only 30 seconds ago
      });

      await expect(
        service.checkOut(actorUserId, {}, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });

      expect(attendanceRepo.checkOutSession).not.toHaveBeenCalled();
    });

    it('should return 409 Conflict if atomic checkOutSession returns null due to concurrent double-tap checkout', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        checkInTime: new Date(Date.now() - 9 * 60 * 60 * 1000),
      });
      attendanceRepo.checkOutSession.mockResolvedValue(null);

      await expect(
        service.checkOut(actorUserId, {}, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should successfully check out and update status to PRESENT if full hours met', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        checkInTime: new Date(Date.now() - 9 * 60 * 60 * 1000), // 9 hours ago
      });

      attendanceRepo.checkOutSession.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.PRESENT,
        totalWorkMinutes: 540,
        checkOutTime: new Date(),
      });

      const result = await service.checkOut(actorUserId, {}, clientMetadata);

      expect(attendanceRepo.checkOutSession).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      expect(result.status).toBe(AttendanceStatus.PRESENT);
    });

    it('should successfully check out overnight shift crossing midnight when check-in was yesterday', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      // Today (next day) has no direct check-in record
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

      // Active session found from yesterday with isOvernight: true
      const overnightAttendance: AttendanceLean = {
        ...mockAttendance,
        attendanceDate: '2026-10-15',
        checkInTime: new Date(Date.now() - 8 * 60 * 60 * 1000), // 8 hours ago
        status: AttendanceStatus.CHECKED_IN,
        shiftSnapshot: {
          name: 'Night Shift',
          code: 'NIGHT',
          startTime: '22:00',
          endTime: '06:00',
          isOvernight: true,
          gracePeriodMinutes: 15,
          minWorkMinutesForFullDay: 480,
          minWorkMinutesForHalfDay: 240,
          overtimeThresholdMinutes: 480,
        },
      };

      attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
        overnightAttendance,
      );

      attendanceRepo.checkOutSession.mockResolvedValue({
        ...overnightAttendance,
        status: AttendanceStatus.PRESENT,
        totalWorkMinutes: 480,
        checkOutTime: new Date(),
      });

      const result = await service.checkOut(actorUserId, {}, clientMetadata);

      expect(attendanceRepo.findActiveSessionByEmployee).toHaveBeenCalledWith(
        mockEmployee._id,
      );
      expect(attendanceRepo.checkOutSession).toHaveBeenCalledWith(
        overnightAttendance._id,
        expect.objectContaining({
          status: AttendanceStatus.PRESENT,
        }),
        expect.anything(),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      expect(result.status).toBe(AttendanceStatus.PRESENT);
    });
  });

  describe('startBreak and endBreak', () => {
    it('should throw VALIDATION_ERROR when starting break if not checked in', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

      await expect(
        service.startBreak(actorUserId, {}, clientMetadata),
      ).rejects.toThrow(AppError);
    });

    it('should throw VALIDATION_ERROR if already ON_BREAK', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.ON_BREAK,
      });

      await expect(
        service.startBreak(actorUserId, {}, clientMetadata),
      ).rejects.toThrow(AppError);
    });

    it('should successfully start a break', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(mockAttendance);
      attendanceRepo.startBreak.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.ON_BREAK,
      });

      const result = await service.startBreak(
        actorUserId,
        { type: BreakType.LUNCH },
        clientMetadata,
      );

      expect(attendanceRepo.startBreak).toHaveBeenCalled();
      expect(result.status).toBe(AttendanceStatus.ON_BREAK);
    });

    it('should throw VALIDATION_ERROR when ending break if not ON_BREAK', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(mockAttendance);

      await expect(
        service.endBreak(actorUserId, {}, clientMetadata),
      ).rejects.toThrow(AppError);
    });

    it('should successfully end an active break', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      const onBreakAttendance = {
        ...mockAttendance,
        status: AttendanceStatus.ON_BREAK,
        breaks: [
          {
            startTime: new Date(Date.now() - 30 * 60 * 1000),
            endTime: null,
            durationMinutes: null,
            type: BreakType.LUNCH,
          },
        ],
      };
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(onBreakAttendance);
      attendanceRepo.endActiveBreak.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.CHECKED_IN,
        totalBreakMinutes: 30,
      });

      const result = await service.endBreak(actorUserId, {}, clientMetadata);

      expect(attendanceRepo.endActiveBreak).toHaveBeenCalled();
      expect(result.status).toBe(AttendanceStatus.CHECKED_IN);
    });

    it('should throw 409 Conflict if atomic startBreak returns null due to concurrent race', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(mockAttendance);
      attendanceRepo.startBreak.mockResolvedValue(null);

      await expect(
        service.startBreak(
          actorUserId,
          { type: BreakType.LUNCH },
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('should throw 409 Conflict if atomic endActiveBreak returns null due to concurrent race', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      const onBreakAttendance = {
        ...mockAttendance,
        status: AttendanceStatus.ON_BREAK,
        breaks: [
          {
            startTime: new Date(Date.now() - 30 * 60 * 1000),
            endTime: null,
            durationMinutes: null,
            type: BreakType.LUNCH,
          },
        ],
      };
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(onBreakAttendance);
      attendanceRepo.endActiveBreak.mockResolvedValue(null);

      await expect(
        service.endBreak(actorUserId, {}, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });
  });

  describe('getCalendar', () => {
    it('should allow employee to view own calendar', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findCalendar.mockResolvedValue([mockAttendance]);

      const result = await service.getCalendar(actorUserId, {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      });

      expect(result).toHaveLength(1);
    });

    it('should allow reporting manager to view direct report calendar', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockManagerEmployee);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      attendanceRepo.findCalendar.mockResolvedValue([mockAttendance]);

      const result = await service.getCalendar(managerUserId, {
        employeeId: employeeId.toString(),
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      });

      expect(result).toHaveLength(1);
    });

    it('should reject unauthorized viewer with FORBIDDEN', async () => {
      const unrelatedUser = new Types.ObjectId();
      const unrelatedEmployee = {
        ...mockEmployee,
        _id: new Types.ObjectId(),
        userId: unrelatedUser,
      };

      employeeRepo.findByUserId.mockResolvedValue(unrelatedEmployee);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      authorizationService.hasPermission.mockResolvedValue(false);

      await expect(
        service.getCalendar(unrelatedUser, {
          employeeId: employeeId.toString(),
          startDate: '2026-10-01',
          endDate: '2026-10-31',
        }),
      ).rejects.toThrow(AppError);
    });
  });

  describe('createRegularization', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // Guard 1: The Future Date Block
    it('should reject regularization for a future date (Guard 1)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-17',
            requestedCheckInTime: '2026-10-17T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-17T12:30:00.000Z',
            reason: 'Future attendance',
          },
          clientMetadata,
        ),
      ).rejects.toThrow('Cannot regularize attendance for a future date');
    });

    // Guard 2: The Payroll Lockout Window (SLA)
    it('should reject regularization if attendanceDate exceeds 7-day payroll lockout SLA (Guard 2)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-01', // 15 days in past relative to 2026-10-16
            requestedCheckInTime: '2026-10-01T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-01T12:30:00.000Z',
            reason: 'Old attendance past SLA',
          },
          clientMetadata,
        ),
      ).rejects.toThrow('Regularization window expired');
    });

    // Guard 3: Chronology Check (Time Travel Block)
    it('should reject regularization if checkOutTime is earlier than or equal to checkInTime (Guard 3)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(mockAttendance);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-15',
            requestedCheckInTime: '2026-10-15T12:30:00.000Z',
            requestedCheckOutTime: '2026-10-15T03:30:00.000Z',
            reason: 'Invalid chronology punch error',
          },
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    });

    // Guard 4: Timestamp to Date Alignment
    it('should reject regularization if requestedCheckInTime date does not match attendanceDate (Guard 4)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(mockAttendance);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-15',
            requestedCheckInTime: '2026-10-14T03:30:00.000Z', // Oct 14 instead of Oct 15
            requestedCheckOutTime: '2026-10-15T12:30:00.000Z',
            reason: 'Misaligned date punch',
          },
          clientMetadata,
        ),
      ).rejects.toThrow('does not match attendanceDate');
    });

    // Guard 5: Roster & Holiday Check
    it('should reject regularization on a weekly off / Sunday (Guard 5)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      // 2026-10-11 was a Sunday
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-11',
            requestedCheckInTime: '2026-10-11T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-11T12:30:00.000Z',
            reason: 'Sunday punch',
          },
          clientMetadata,
        ),
      ).rejects.toThrow('Cannot regularize attendance on a weekly off');
    });

    it('should reject regularization on a company holiday (Guard 5)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.HOLIDAY,
      });

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-15',
            requestedCheckInTime: '2026-10-15T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-15T12:30:00.000Z',
            reason: 'Holiday punch',
          },
          clientMetadata,
        ),
      ).rejects.toThrow('Cannot regularize attendance on a company holiday');
    });

    it('should reject regularization on an approved leave day (Guard 5)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.ON_LEAVE,
      });

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-15',
            requestedCheckInTime: '2026-10-15T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-15T12:30:00.000Z',
            reason: 'Leave day punch',
          },
          clientMetadata,
        ),
      ).rejects.toThrow('Cannot regularize attendance on a approved leave');
    });

    // Guard 6: The "Double Dip" Prevention
    it('should reject regularization if a pending request already exists (Guard 6)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(
        mockRegularization,
      );

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-15',
            requestedCheckInTime: '2026-10-15T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-15T12:30:00.000Z',
            reason: 'Duplicate regularization',
          },
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    // Guard 7: Existing Status Validation
    it('should reject regularization if attendance is already PRESENT / Full Day (Guard 7)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.PRESENT,
      });
      regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(null);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-15',
            requestedCheckInTime: '2026-10-15T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-15T12:30:00.000Z',
            reason: 'Attempting to regularize a full day',
          },
          clientMetadata,
        ),
      ).rejects.toThrow('already marked as PRESENT (Full Day)');
    });

    it('should reject regularization if attendance is already REGULARIZED (Guard 7)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.REGULARIZED,
      });
      regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(null);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-15',
            requestedCheckInTime: '2026-10-15T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-15T12:30:00.000Z',
            reason: 'Attempting to re-regularize',
          },
          clientMetadata,
        ),
      ).rejects.toThrow('has already been regularized and approved');
    });

    it('should reject regularization if requested punches fall outside shift window boundary', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(mockAttendance);
      regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(null);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-15',
            requestedCheckInTime: '2026-10-14T20:00:00.000Z', // Before 6h buffer of shift start (03:30 UTC)
            requestedCheckOutTime: '2026-10-15T12:00:00.000Z',
            reason: 'Out of bounds',
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        'Requested punch times fall outside the allowable 24-hour shift window',
      );
    });

    it('should create pending regularization audit record capturing original punches', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(mockAttendance);
      regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(null);
      regularizationRepo.create.mockResolvedValue(mockRegularization);

      const result = await service.createRegularization(
        actorUserId,
        {
          attendanceDate: '2026-10-15',
          requestedCheckInTime: '2026-10-15T03:30:00.000Z',
          requestedCheckOutTime: '2026-10-15T12:30:00.000Z',
          reason: 'Forgot to punch out due to client meeting',
          type: RegularizationType.FORGOT_PUNCH,
        },
        clientMetadata,
      );

      expect(regularizationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: RegularizationStatus.PENDING,
          attendanceDate: '2026-10-15',
          originalCheckInTime: mockAttendance.checkInTime,
          type: RegularizationType.FORGOT_PUNCH,
        }),
        expect.anything(),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      expect(result.status).toBe(RegularizationStatus.PENDING);
    });

    it('should parse simple time strings (HH:mm) into branch timezone UTC Date objects, immunizing from client timezone errors', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(mockAttendance);
      regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(null);
      regularizationRepo.create.mockResolvedValue(mockRegularization);

      await service.createRegularization(
        actorUserId,
        {
          attendanceDate: '2026-10-15',
          requestedCheckInTime: '09:00',
          requestedCheckOutTime: '18:00',
          reason: 'Biometric offline morning',
          type: RegularizationType.TIME_CORRECTION,
        },
        clientMetadata,
      );

      expect(regularizationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedCheckInTime: new Date('2026-10-15T03:30:00.000Z'),
          requestedCheckOutTime: new Date('2026-10-15T12:30:00.000Z'),
        }),
        expect.anything(),
      );
    });
  });

  describe('regularization approval workflow', () => {
    it('should prohibit self-approval with FORBIDDEN', async () => {
      regularizationRepo.findById.mockResolvedValue(mockRegularization);
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee); // employee is approver

      await expect(
        service.approveRegularization(
          regularizationId,
          actorUserId,
          {},
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('should allow manager to approve regularization and upgrade attendance status from INCOMPLETE to PRESENT', async () => {
      regularizationRepo.findById.mockResolvedValue(mockRegularization);
      employeeRepo.findByUserId.mockResolvedValue(mockManagerEmployee);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      regularizationRepo.updateStatus.mockResolvedValue({
        ...mockRegularization,
        status: RegularizationStatus.APPROVED,
        reviewedBy: managerUserId,
        reviewedAt: new Date(),
      });
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.INCOMPLETE,
      });
      shiftService.resolveShift.mockResolvedValue(mockShift);
      attendanceRepo.updateById.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.PRESENT,
      });

      const result = await service.approveRegularization(
        regularizationId,
        managerUserId,
        { reviewRemarks: 'Approved' },
        clientMetadata,
      );

      expect(regularizationRepo.updateStatus).toHaveBeenCalledWith(
        regularizationId,
        RegularizationStatus.APPROVED,
        managerUserId,
        expect.any(Date),
        'Approved',
        expect.anything(),
      );
      // Status upgraded to PRESENT (9 hours = 540 min - 60 min break = 480 min >= 480 min full day)
      expect(attendanceRepo.updateById).toHaveBeenCalledWith(
        mockAttendance._id,
        expect.objectContaining({
          status: AttendanceStatus.PRESENT,
          totalBreakMinutes: 60,
          totalWorkMinutes: 480,
          isLate: false,
          lateMinutes: 0,
          regularizationId,
        }),
        expect.anything(),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      expect(result.status).toBe(RegularizationStatus.APPROVED);
    });

    it('should upgrade attendance status to HALF_DAY if regularized work minutes meet half-day threshold', async () => {
      const halfDayReg: AttendanceRegularizationLean = {
        ...mockRegularization,
        requestedCheckInTime: new Date('2026-10-15T03:30:00.000Z'),
        requestedCheckOutTime: new Date('2026-10-15T08:30:00.000Z'), // 5 hours = 300m >= 240m (half day), < 480m (full day)
      };

      regularizationRepo.findById.mockResolvedValue(halfDayReg);
      employeeRepo.findByUserId.mockResolvedValue(mockManagerEmployee);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      regularizationRepo.updateStatus.mockResolvedValue({
        ...halfDayReg,
        status: RegularizationStatus.APPROVED,
      });
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.INCOMPLETE,
      });
      shiftService.resolveShift.mockResolvedValue(mockShift);
      attendanceRepo.updateById.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.HALF_DAY,
      });

      await service.approveRegularization(
        regularizationId,
        managerUserId,
        { reviewRemarks: 'Approved half day' },
        clientMetadata,
      );

      expect(attendanceRepo.updateById).toHaveBeenCalledWith(
        mockAttendance._id,
        expect.objectContaining({
          status: AttendanceStatus.HALF_DAY,
          totalBreakMinutes: 60,
          totalWorkMinutes: 240,
          regularizationId,
        }),
        expect.anything(),
      );
    });

    it('should create new regularized attendance record if employee had no prior record (no-show regularization)', async () => {
      regularizationRepo.findById.mockResolvedValue(mockRegularization);
      employeeRepo.findByUserId.mockResolvedValue(mockManagerEmployee);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      regularizationRepo.updateStatus.mockResolvedValue({
        ...mockRegularization,
        status: RegularizationStatus.APPROVED,
      });
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null); // No prior record
      shiftService.resolveShift.mockResolvedValue(mockShift);
      attendanceRepo.create.mockResolvedValue(mockAttendance);

      await service.approveRegularization(
        regularizationId,
        managerUserId,
        { reviewRemarks: 'Approved missed day' },
        clientMetadata,
      );

      expect(attendanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AttendanceStatus.PRESENT,
          totalBreakMinutes: 60,
          totalWorkMinutes: 480,
          regularizationId,
          attendanceDate: '2026-10-15',
        }),
        expect.anything(),
      );
    });

    it('should reject approval with 409 CONFLICT if request is already non-PENDING (state lock)', async () => {
      regularizationRepo.findById.mockResolvedValue({
        ...mockRegularization,
        status: RegularizationStatus.APPROVED,
      });

      await expect(
        service.approveRegularization(
          regularizationId,
          managerUserId,
          {},
          clientMetadata,
        ),
      ).rejects.toThrow('already APPROVED');
    });

    it('should reject approval with 409 CONFLICT if atomic update returns null due to concurrent transition', async () => {
      regularizationRepo.findById.mockResolvedValue(mockRegularization);
      employeeRepo.findByUserId.mockResolvedValue(mockManagerEmployee);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      regularizationRepo.updateStatus.mockResolvedValue(null); // Concurrently updated by another process

      await expect(
        service.approveRegularization(
          regularizationId,
          managerUserId,
          {},
          clientMetadata,
        ),
      ).rejects.toThrow('concurrently');
    });
  });

  describe('regularization rejection workflow', () => {
    it('should throw 400 BAD_REQUEST if rejection reason is missing', async () => {
      regularizationRepo.findById.mockResolvedValue(mockRegularization);

      await expect(
        service.rejectRegularization(
          regularizationId,
          managerUserId,
          { reason: '' },
          clientMetadata,
        ),
      ).rejects.toThrow('Rejection reason is required');
    });

    it('should reject with 409 CONFLICT if request is already non-PENDING (state lock)', async () => {
      regularizationRepo.findById.mockResolvedValue({
        ...mockRegularization,
        status: RegularizationStatus.REJECTED,
      });

      await expect(
        service.rejectRegularization(
          regularizationId,
          managerUserId,
          { reason: 'Too late' },
          clientMetadata,
        ),
      ).rejects.toThrow('already REJECTED');
    });

    it('should prohibit self-rejection with 403 FORBIDDEN', async () => {
      regularizationRepo.findById.mockResolvedValue(mockRegularization);
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee); // employee is reviewer

      await expect(
        service.rejectRegularization(
          regularizationId,
          actorUserId,
          { reason: 'Self review' },
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });

    it('should allow authorized manager to reject regularization with reason', async () => {
      regularizationRepo.findById.mockResolvedValue(mockRegularization);
      employeeRepo.findByUserId.mockResolvedValue(mockManagerEmployee);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      regularizationRepo.updateStatus.mockResolvedValue({
        ...mockRegularization,
        status: RegularizationStatus.REJECTED,
        reviewedBy: managerUserId,
        reviewedAt: new Date(),
        reviewRemarks: 'No evidence provided.',
      });

      const result = await service.rejectRegularization(
        regularizationId,
        managerUserId,
        { reason: 'No evidence provided.' },
        clientMetadata,
      );

      expect(regularizationRepo.updateStatus).toHaveBeenCalledWith(
        regularizationId,
        RegularizationStatus.REJECTED,
        managerUserId,
        expect.any(Date),
        'No evidence provided.',
        expect.anything(),
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      expect(result.status).toBe(RegularizationStatus.REJECTED);
    });

    it('should throw 409 CONFLICT if atomic reject update fails due to concurrent modification', async () => {
      regularizationRepo.findById.mockResolvedValue(mockRegularization);
      employeeRepo.findByUserId.mockResolvedValue(mockManagerEmployee);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      regularizationRepo.updateStatus.mockResolvedValue(null);

      await expect(
        service.rejectRegularization(
          regularizationId,
          managerUserId,
          { reason: 'Duplicate' },
          clientMetadata,
        ),
      ).rejects.toThrow('concurrently');
    });
  });

  describe('recordManualAttendance', () => {
    const adminUserId = new Types.ObjectId();
    const targetEmpId = new Types.ObjectId();
    const explicitShiftId = new Types.ObjectId();
    const explicitShift: ShiftLean = {
      ...mockShift,
      _id: explicitShiftId,
      code: 'MANUAL_SHIFT',
    };

    it('should allow authorized Admin/HR to manually record attendance with explicit shift override', async () => {
      authorizationService.hasPermission.mockResolvedValue(true);
      employeeRepo.findById.mockResolvedValue({
        ...mockEmployee,
        _id: targetEmpId,
      });
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      shiftService.resolveShift.mockResolvedValue(explicitShift);
      attendanceRepo.create.mockResolvedValue({
        ...mockAttendance,
        employeeId: targetEmpId,
        shiftId: explicitShiftId,
      });

      const result = await service.recordManualAttendance(
        adminUserId,
        {
          employeeId: targetEmpId.toString(),
          attendanceDate: '2026-10-23',
          checkInTime: '2026-10-23T03:30:00.000Z',
          shiftId: explicitShiftId.toString(),
        },
        clientMetadata,
      );

      expect(shiftService.resolveShift).toHaveBeenCalledWith(
        expect.anything(),
        explicitShiftId,
        expect.objectContaining({ isAdminOverride: true }),
      );
      expect(attendanceRepo.create).toHaveBeenCalled();
      expect(result.status).toBe(AttendanceStatus.CHECKED_IN);
    });

    it('should reject manual attendance if caller lacks admin permission', async () => {
      authorizationService.hasPermission.mockResolvedValue(false);

      await expect(
        service.recordManualAttendance(
          adminUserId,
          {
            employeeId: targetEmpId.toString(),
            attendanceDate: '2026-10-23',
            checkInTime: '2026-10-23T03:30:00.000Z',
          },
          clientMetadata,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        statusCode: HttpStatus.FORBIDDEN,
      });
    });
  });

  describe('P0 Issue 1: Timezone Inconsistency Resolution', () => {
    it('should resolve attendanceDate using employee branch timezone across checkIn, checkOut, and getTodayStatus', async () => {
      // Branch in New York (America/New_York)
      // At UTC timestamp 2026-10-15T02:00:00.000Z (which is 2026-10-14 22:00:00 EDT)
      const nyBranch = {
        name: 'New York Office',
        timezone: 'America/New_York',
        allowedIps: ['127.0.0.1'],
        isActive: true,
        deletedAt: null,
        createdBy: null,
        updatedBy: null,
        deletedBy: null,
      } as unknown as Branch;
      branchRepo.findById.mockResolvedValue(nyBranch);
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      shiftService.resolveShift.mockResolvedValue(mockShift);
      attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

      // Fix system clock to 2026-10-15T02:00:00.000Z
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T02:00:00.000Z'));

      try {
        // In America/New_York (UTC-4 in Oct DST), 2026-10-15 02:00:00 UTC is 2026-10-14 22:00:00 EDT
        // Therefore attendanceDate MUST be 2026-10-14, NOT 2026-10-15!
        attendanceRepo.create.mockResolvedValue({
          ...mockAttendance,
          attendanceDate: '2026-10-14',
          checkInTime: new Date('2026-10-15T02:00:00.000Z'),
        });

        const checkInRes = await service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        // Verify checkIn queried and saved for 2026-10-14
        expect(attendanceRepo.findByEmployeeAndDate).toHaveBeenCalledWith(
          employeeId,
          '2026-10-14',
        );
        expect(checkInRes.attendanceDate).toBe('2026-10-14');

        // Now test checkOut at same time
        const activeNyAttendance: AttendanceLean = {
          ...mockAttendance,
          attendanceDate: '2026-10-14',
          checkInTime: new Date('2026-10-14T14:00:00.000Z'),
          status: AttendanceStatus.CHECKED_IN,
        };
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(
          activeNyAttendance,
        );
        attendanceRepo.checkOutSession.mockResolvedValue({
          ...activeNyAttendance,
          checkOutTime: new Date('2026-10-15T02:00:00.000Z'),
          status: AttendanceStatus.PRESENT,
        });

        const checkOutRes = await service.checkOut(
          actorUserId,
          {},
          clientMetadata,
        );
        expect(checkOutRes.attendanceDate).toBe('2026-10-14');

        // Now test getTodayStatus at same time
        const todayRes = await service.getTodayStatus(actorUserId);
        expect(todayRes.attendance?.attendanceDate).toBe('2026-10-14');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should pass employee branch timezone to shift window calculation on checkOut', async () => {
      const dubaiBranch = {
        name: 'Dubai Office',
        timezone: 'Asia/Dubai',
        allowedIps: ['127.0.0.1'],
        isActive: true,
        deletedAt: null,
        createdBy: null,
        updatedBy: null,
        deletedBy: null,
      } as unknown as Branch;
      branchRepo.findById.mockResolvedValue(dubaiBranch);
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);

      const activeDubaiAtt: AttendanceLean = {
        ...mockAttendance,
        attendanceDate: '2026-10-15',
        checkInTime: new Date('2026-10-15T05:00:00.000Z'), // 09:00 GST
        status: AttendanceStatus.CHECKED_IN,
      };
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(activeDubaiAtt);
      attendanceRepo.checkOutSession.mockResolvedValue({
        ...activeDubaiAtt,
        checkOutTime: new Date('2026-10-15T14:00:00.000Z'), // 18:00 GST
        status: AttendanceStatus.PRESENT,
      });

      const spyGetShiftWindow = jest.spyOn(
        AttendanceCalculationUtil,
        'getShiftWindow',
      );

      await service.checkOut(actorUserId, {}, clientMetadata);

      expect(spyGetShiftWindow).toHaveBeenCalledWith(
        '2026-10-15',
        expect.anything(),
        'Asia/Dubai',
      );
      spyGetShiftWindow.mockRestore();
    });
  });

  describe('P0 Issue 2: Approved-Leave Check-In Collision', () => {
    it('should reject check-in with 409 Conflict when employee has an approved full-day leave for today', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);

      const leaveReqId = new Types.ObjectId();
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.ON_LEAVE,
        checkInTime: null,
        checkOutTime: null,
        leaveRequestId: leaveReqId,
      });

      leaveRequestRepo.findById.mockResolvedValue({
        _id: leaveReqId,
        employeeId,
        status: LeaveRequestStatus.APPROVED,
        isHalfDay: false,
      } as unknown as LeaveRequestLean);

      await expect(
        service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        ),
      ).rejects.toThrow(
        /Cannot check in: You have an approved full-day leave for today/i,
      );
    });

    it('should reject check-in during approved FIRST_HALF leave period (before shift midpoint)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);
      shiftService.resolveShift.mockResolvedValue(mockShift);

      const leaveReqId = new Types.ObjectId();
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.HALF_DAY,
        checkInTime: null,
        checkOutTime: null,
        leaveRequestId: leaveReqId,
      });

      leaveRequestRepo.findById.mockResolvedValue({
        _id: leaveReqId,
        employeeId,
        status: LeaveRequestStatus.APPROVED,
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
      } as unknown as LeaveRequestLean);

      // Shift is 09:00 - 18:00 IST (midpoint is 13:30 IST)
      // Attempt check-in at 10:00 IST (04:30 UTC) -> during first-half leave!
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T04:30:00.000Z'));

      try {
        await expect(
          service.checkIn(
            actorUserId,
            { workMode: WorkMode.OFFICE },
            clientMetadata,
          ),
        ).rejects.toThrow(
          /Cannot check in during your approved first-half leave period/i,
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('should allow check-in during second-half for approved FIRST_HALF leave, atomically updating existing attendance record', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);
      shiftService.resolveShift.mockResolvedValue(mockShift);

      const leaveReqId = new Types.ObjectId();
      const existingHalfDayRecord: AttendanceLean = {
        ...mockAttendance,
        status: AttendanceStatus.HALF_DAY,
        checkInTime: null,
        checkOutTime: null,
        leaveRequestId: leaveReqId,
      };
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(
        existingHalfDayRecord,
      );

      leaveRequestRepo.findById.mockResolvedValue({
        _id: leaveReqId,
        employeeId,
        status: LeaveRequestStatus.APPROVED,
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
      } as unknown as LeaveRequestLean);

      // Shift is 09:00 - 18:00 IST (midpoint is 13:30 IST = 08:00 UTC)
      // Check in at 13:35 IST (08:05 UTC) -> eligible for second-half working session!
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T08:05:00.000Z'));

      const updatedRecord: AttendanceLean = {
        ...existingHalfDayRecord,
        checkInTime: new Date('2026-10-15T08:05:00.000Z'),
        status: AttendanceStatus.CHECKED_IN,
        isLate: false,
        lateMinutes: 0,
      };
      attendanceRepo.updateCheckInForExistingLeave.mockResolvedValue(
        updatedRecord,
      );

      try {
        const res = await service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        expect(
          attendanceRepo.updateCheckInForExistingLeave,
        ).toHaveBeenCalledWith(
          existingHalfDayRecord._id,
          expect.objectContaining({
            checkInTime: new Date('2026-10-15T08:05:00.000Z'),
            status: AttendanceStatus.CHECKED_IN,
            leaveRequestId: leaveReqId, // Preserves leave reference
            isLate: false,
          }),
          expect.anything(),
        );
        expect(res.status).toBe(AttendanceStatus.CHECKED_IN);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should reject check-in during approved SECOND_HALF leave period (at or after shift midpoint)', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);
      shiftService.resolveShift.mockResolvedValue(mockShift);

      const leaveReqId = new Types.ObjectId();
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.HALF_DAY,
        checkInTime: null,
        checkOutTime: null,
        leaveRequestId: leaveReqId,
      });

      leaveRequestRepo.findById.mockResolvedValue({
        _id: leaveReqId,
        employeeId,
        status: LeaveRequestStatus.APPROVED,
        isHalfDay: true,
        halfDaySession: HalfDaySession.SECOND_HALF,
      } as unknown as LeaveRequestLean);

      // Shift is 09:00 - 18:00 IST (midpoint is 13:30 IST = 08:00 UTC)
      // Attempt check-in at 14:00 IST (08:30 UTC) -> during second-half leave!
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T08:30:00.000Z'));

      try {
        await expect(
          service.checkIn(
            actorUserId,
            { workMode: WorkMode.OFFICE },
            clientMetadata,
          ),
        ).rejects.toThrow(
          /Cannot check in during your approved second-half leave period/i,
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('should cap attendance status to HALF_DAY on checkOut when linked to an approved half-day leave even if work hours qualify for PRESENT', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);

      const leaveReqId = new Types.ObjectId();
      leaveRequestRepo.findById.mockResolvedValue({
        _id: leaveReqId,
        status: LeaveRequestStatus.APPROVED,
        isHalfDay: true,
      } as unknown as LeaveRequestLean);
      const halfDayAtt: AttendanceLean = {
        ...mockAttendance,
        attendanceDate: '2026-10-15',
        checkInTime: new Date('2026-10-15T03:30:00.000Z'),
        status: AttendanceStatus.CHECKED_IN,
        leaveRequestId: leaveReqId,
      };
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(halfDayAtt);

      // Check-out after 9 hours (540 minutes, normally PRESENT)
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T12:30:00.000Z'));

      attendanceRepo.checkOutSession.mockImplementation((_id, updateData) =>
        Promise.resolve({
          ...halfDayAtt,
          ...updateData,
        } as AttendanceLean),
      );

      try {
        const res = await service.checkOut(actorUserId, {}, clientMetadata);

        // Status must be capped to HALF_DAY to prevent double counting in payroll
        expect(res.status).toBe(AttendanceStatus.HALF_DAY);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should handle concurrent check-in race on half-day leave by catching null from updateCheckInForExistingLeave', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);
      shiftService.resolveShift.mockResolvedValue(mockShift);

      const leaveReqId = new Types.ObjectId();
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.HALF_DAY,
        checkInTime: null,
        checkOutTime: null,
        leaveRequestId: leaveReqId,
      });

      leaveRequestRepo.findById.mockResolvedValue({
        _id: leaveReqId,
        employeeId,
        status: LeaveRequestStatus.APPROVED,
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
      } as unknown as LeaveRequestLean);

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T08:05:00.000Z'));

      // Simulate concurrent winner already set checkInTime, so atomic update returns null
      attendanceRepo.updateCheckInForExistingLeave.mockResolvedValue(null);

      try {
        await expect(
          service.checkIn(
            actorUserId,
            { workMode: WorkMode.OFFICE },
            clientMetadata,
          ),
        ).rejects.toThrow(/Already checked in for today/i);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('P0 Issue 3: Holiday Validation in Attendance Regularization', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should reject regularization when no attendance record exists (absent/missing) on a public/company holiday', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);
      // No attendance record exists for the holiday date
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

      // HolidayRepository returns active PUBLIC holiday
      holidayRepo.findApplicableHolidays.mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          name: 'Republic Day',
          date: '2026-10-15',
          year: 2026,
          type: HolidayType.PUBLIC,
          branchId: null,
          isActive: true,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as HolidayLean,
      ]);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-15',
            requestedCheckInTime: '2026-10-15T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-15T12:30:00.000Z',
            reason: 'Tried to regularize holiday punch',
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        /Cannot regularize attendance on a company holiday \(Republic Day\) \(2026-10-15\)\. Regularization is only permitted on scheduled working days\. Please submit a Comp-Off or Overtime request instead\./i,
      );
    });

    it('should reject regularization on a branch-specific holiday when employee belongs to that branch', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

      holidayRepo.findApplicableHolidays.mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          name: 'Karnataka Rajyotsava',
          date: '2026-10-15',
          year: 2026,
          type: HolidayType.REGIONAL,
          branchId: mockEmployee.branchId,
          isActive: true,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as HolidayLean,
      ]);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-15',
            requestedCheckInTime: '2026-10-15T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-15T12:30:00.000Z',
            reason: 'Regional holiday punch',
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        /Cannot regularize attendance on a company holiday \(Karnataka Rajyotsava\) \(2026-10-15\)/i,
      );
    });

    it('should ignore soft-deleted or inactive holidays during regularization check', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.ABSENT,
      });
      regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(null);
      shiftService.resolveShift.mockResolvedValue(mockShift);

      // Holiday is soft-deleted or inactive
      holidayRepo.findApplicableHolidays.mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          name: 'Cancelled Festival',
          date: '2026-10-15',
          year: 2026,
          type: HolidayType.PUBLIC,
          branchId: null,
          isActive: false,
          deletedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as HolidayLean,
      ]);
      leaveRequestRepo.findOverlappingRequests.mockResolvedValue([]);

      regularizationRepo.create.mockResolvedValue(mockRegularization);

      const res = await service.createRegularization(
        actorUserId,
        {
          attendanceDate: '2026-10-15',
          requestedCheckInTime: '2026-10-15T03:30:00.000Z',
          requestedCheckOutTime: '2026-10-15T12:30:00.000Z',
          reason: 'Valid regularization on working day after cancelled holiday',
        },
        clientMetadata,
      );

      expect(res).toBeDefined();
      expect(regularizationRepo.create).toHaveBeenCalled();
    });

    it('should reject regularization when employee has an approved full-day leave in LeaveRequestRepository even if attendance record is null', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      holidayRepo.findApplicableHolidays.mockResolvedValue([]);

      leaveRequestRepo.findOverlappingRequests.mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          employeeId,
          status: LeaveRequestStatus.APPROVED,
          isHalfDay: false,
          startDate: '2026-10-15',
          endDate: '2026-10-15',
        } as unknown as LeaveRequestLean,
      ]);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: '2026-10-15',
            requestedCheckInTime: '2026-10-15T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-15T12:30:00.000Z',
            reason:
              'Regularizing on approved leave date with no attendance record',
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        /Cannot regularize attendance on a approved leave \(2026-10-15\)/i,
      );
    });
  });

  describe('P0 Remediation Tests: Timezone, Cancelled Leaves & Overnight Shifts', () => {
    it('1. should record manual attendance using employee non-IST branch timezone', async () => {
      const dubaiBranchId = new Types.ObjectId();
      const dubaiBranch = {
        ...mockBranch,
        _id: dubaiBranchId,
        name: 'Dubai Branch',
        code: 'DXB-01',
        timezone: 'Asia/Dubai', // UTC+4
      } as unknown as Branch;

      const dubaiEmployee: EmployeeLean = {
        ...mockEmployee,
        branchId: dubaiBranchId,
      };

      authorizationService.hasPermission.mockResolvedValue(true);
      employeeRepo.findById.mockResolvedValue(dubaiEmployee);
      branchRepo.findById.mockResolvedValue(dubaiBranch);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

      const standardShift: ShiftLean = {
        ...mockShift,
        startTime: '09:00',
        endTime: '18:00',
        isOvernight: false,
        minWorkMinutesForFullDay: 480,
        minWorkMinutesForHalfDay: 240,
        overtimeThresholdMinutes: 540,
      };
      shiftService.resolveShift.mockResolvedValue(standardShift);

      attendanceRepo.create.mockImplementation((data) =>
        Promise.resolve({
          _id: new Types.ObjectId(),
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as AttendanceLean),
      );

      // Record manual attendance in Dubai: 09:00 to 18:00 on 2026-10-15
      // 09:00 Asia/Dubai is 05:00 UTC. 18:00 Asia/Dubai is 14:00 UTC.
      const res = await service.recordManualAttendance(
        actorUserId,
        {
          employeeId: dubaiEmployee._id.toString(),
          attendanceDate: '2026-10-15',
          checkInTime: '09:00',
          checkOutTime: '18:00',
          notes: 'Admin manual entry for Dubai employee',
        },
        clientMetadata,
      );

      expect(res).toBeDefined();
      expect(attendanceRepo.create).toHaveBeenCalled();
      const createArg = attendanceRepo.create.mock.calls[0][0];

      // Verify UTC timestamps match Asia/Dubai conversion
      expect(createArg.checkInTime).toEqual(
        new Date('2026-10-15T05:00:00.000Z'),
      );
      expect(createArg.checkOutTime).toEqual(
        new Date('2026-10-15T14:00:00.000Z'),
      );
      expect(createArg.isLate).toBe(false);
      expect(createArg.status).toBe(AttendanceStatus.PRESENT);
      expect(createArg.totalWorkMinutes).toBe(540);
    });

    it('2. should not downgrade status to HALF_DAY on checkout when a cancelled full-day leave was followed by a complete working day', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);

      const leaveReqId = new Types.ObjectId();
      // Leave was CANCELLED
      leaveRequestRepo.findById.mockResolvedValue({
        _id: leaveReqId,
        status: LeaveRequestStatus.CANCELLED,
        isHalfDay: false,
      } as unknown as LeaveRequestLean);

      const cancelledLeaveAtt: AttendanceLean = {
        ...mockAttendance,
        attendanceDate: '2026-10-15',
        checkInTime: new Date('2026-10-15T03:30:00.000Z'),
        status: AttendanceStatus.CHECKED_IN,
        leaveRequestId: leaveReqId, // Preserved on document
      };
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(cancelledLeaveAtt);

      // Checkout after 9 hours of work (540 minutes, normally PRESENT)
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T12:30:00.000Z'));

      attendanceRepo.checkOutSession.mockImplementation((_id, updateData) =>
        Promise.resolve({
          ...cancelledLeaveAtt,
          ...updateData,
        } as AttendanceLean),
      );

      try {
        const res = await service.checkOut(actorUserId, {}, clientMetadata);

        // Status must NOT be capped to HALF_DAY because leave was cancelled!
        expect(res.status).toBe(AttendanceStatus.PRESENT);
      } finally {
        jest.useRealTimers();
      }
    });

    it('3. should cap status to HALF_DAY on checkout for an active approved half-day leave even if employee worked full day hours', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);

      const leaveReqId = new Types.ObjectId();
      // Leave is APPROVED and isHalfDay
      leaveRequestRepo.findById.mockResolvedValue({
        _id: leaveReqId,
        status: LeaveRequestStatus.APPROVED,
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
      } as unknown as LeaveRequestLean);

      const approvedHalfDayAtt: AttendanceLean = {
        ...mockAttendance,
        attendanceDate: '2026-10-15',
        checkInTime: new Date('2026-10-15T08:00:00.000Z'),
        status: AttendanceStatus.CHECKED_IN,
        leaveRequestId: leaveReqId,
      };
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(
        approvedHalfDayAtt,
      );

      // Checkout after 9 hours (normally qualifies for PRESENT)
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T17:00:00.000Z'));

      attendanceRepo.checkOutSession.mockImplementation((_id, updateData) =>
        Promise.resolve({
          ...approvedHalfDayAtt,
          ...updateData,
        } as AttendanceLean),
      );

      try {
        const res = await service.checkOut(actorUserId, {}, clientMetadata);

        // Status must be capped to HALF_DAY to align with approved half-day leave
        expect(res.status).toBe(AttendanceStatus.HALF_DAY);
      } finally {
        jest.useRealTimers();
      }
    });

    it('4. should support check-in against yesterday shift date for overnight first-half leave when check-in occurs after midnight', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);

      const overnightShift: ShiftLean = {
        ...mockShift,
        startTime: '20:00',
        endTime: '05:00',
        isOvernight: true,
        gracePeriodMinutes: 15,
        minWorkMinutesForHalfDay: 240,
        minWorkMinutesForFullDay: 480,
      };
      shiftService.resolveShift.mockResolvedValue(overnightShift);

      const leaveReqId = new Types.ObjectId();
      const yesterdayLeaveAtt: AttendanceLean = {
        ...mockAttendance,
        _id: new Types.ObjectId(),
        attendanceDate: '2026-10-15',
        checkInTime: null,
        status: AttendanceStatus.ON_LEAVE,
        leaveRequestId: leaveReqId,
      };

      // Current time is 2026-10-16 00:35 IST (2026-10-15T19:05:00.000Z)
      // Calendar date in IST is 2026-10-16, but shift started on 2026-10-15
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T19:05:00.000Z'));

      attendanceRepo.findByEmployeeAndDate.mockImplementation(
        (_empId, dateStr) => {
          if (dateStr === '2026-10-16') return Promise.resolve(null);
          if (dateStr === '2026-10-15')
            return Promise.resolve(yesterdayLeaveAtt);
          return Promise.resolve(null);
        },
      );

      leaveRequestRepo.findById.mockResolvedValue({
        _id: leaveReqId,
        status: LeaveRequestStatus.APPROVED,
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
      } as unknown as LeaveRequestLean);

      attendanceRepo.updateCheckInForExistingLeave.mockImplementation(
        (_id, updateData) =>
          Promise.resolve({
            ...yesterdayLeaveAtt,
            ...updateData,
            status: AttendanceStatus.CHECKED_IN,
          } as AttendanceLean),
      );

      try {
        const res = await service.checkIn(actorUserId, {}, clientMetadata);

        expect(res).toBeDefined();
        // Crucial: Must anchor to yesterday's shift date (2026-10-15)
        expect(res.attendanceDate).toBe('2026-10-15');
        expect(
          attendanceRepo.updateCheckInForExistingLeave,
        ).toHaveBeenCalledWith(
          yesterdayLeaveAtt._id,
          expect.objectContaining({
            attendanceDate: '2026-10-15',
          }),
          expect.anything(),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('5. should reject check-in past midpoint for overnight second-half leave', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);

      const overnightShift: ShiftLean = {
        ...mockShift,
        startTime: '20:00',
        endTime: '05:00',
        isOvernight: true,
        gracePeriodMinutes: 15,
        minWorkMinutesForHalfDay: 240,
        minWorkMinutesForFullDay: 480,
      };
      shiftService.resolveShift.mockResolvedValue(overnightShift);

      const leaveReqId = new Types.ObjectId();
      const yesterdayLeaveAtt: AttendanceLean = {
        ...mockAttendance,
        attendanceDate: '2026-10-15',
        checkInTime: null,
        status: AttendanceStatus.ON_LEAVE,
        leaveRequestId: leaveReqId,
      };

      // Current time is 2026-10-16 01:00 IST (2026-10-15T19:30:00.000Z)
      // Midpoint is 2026-10-16 00:30 IST. Employee with SECOND_HALF leave was only eligible until 00:30!
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T19:30:00.000Z'));

      attendanceRepo.findByEmployeeAndDate.mockImplementation(
        (_empId, dateStr) => {
          if (dateStr === '2026-10-16') return Promise.resolve(null);
          if (dateStr === '2026-10-15')
            return Promise.resolve(yesterdayLeaveAtt);
          return Promise.resolve(null);
        },
      );

      leaveRequestRepo.findById.mockResolvedValue({
        _id: leaveReqId,
        status: LeaveRequestStatus.APPROVED,
        isHalfDay: true,
        halfDaySession: HalfDaySession.SECOND_HALF,
      } as unknown as LeaveRequestLean);

      try {
        await expect(
          service.checkIn(actorUserId, {}, clientMetadata),
        ).rejects.toThrow(
          /Cannot check in during your approved second-half leave period/i,
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('6. should reject duplicate check-in when employee is already checked in for today', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);

      const existingCheckedIn: AttendanceLean = {
        ...mockAttendance,
        attendanceDate: '2026-10-15',
        checkInTime: new Date('2026-10-15T04:00:00.000Z'),
        status: AttendanceStatus.CHECKED_IN,
      };
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(existingCheckedIn);

      await expect(
        service.checkIn(actorUserId, {}, clientMetadata),
      ).rejects.toMatchObject({
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        statusCode: HttpStatus.CONFLICT,
      });
    });

    it('7. should allow check-in when approved full-day leave was cancelled before shift', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      branchRepo.findById.mockResolvedValue(mockBranch);
      shiftService.resolveShift.mockResolvedValue(mockShift);

      const leaveReqId = new Types.ObjectId();
      const cancelledLeaveAtt: AttendanceLean = {
        ...mockAttendance,
        _id: new Types.ObjectId(),
        attendanceDate: '2026-10-15',
        checkInTime: null,
        status: AttendanceStatus.ON_LEAVE,
        leaveRequestId: leaveReqId,
      };
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(cancelledLeaveAtt);

      // Leave was CANCELLED
      leaveRequestRepo.findById.mockResolvedValue({
        _id: leaveReqId,
        status: LeaveRequestStatus.CANCELLED,
        isHalfDay: false,
      } as unknown as LeaveRequestLean);

      attendanceRepo.updateCheckInForExistingLeave.mockImplementation(
        (_id, updateData) =>
          Promise.resolve({
            ...cancelledLeaveAtt,
            ...updateData,
            status: AttendanceStatus.CHECKED_IN,
          } as AttendanceLean),
      );

      const res = await service.checkIn(actorUserId, {}, clientMetadata);

      expect(res).toBeDefined();
      expect(attendanceRepo.updateCheckInForExistingLeave).toHaveBeenCalledWith(
        cancelledLeaveAtt._id,
        expect.objectContaining({
          status: AttendanceStatus.CHECKED_IN,
          leaveRequestId: leaveReqId,
        }),
        expect.anything(),
      );
    });
  });

  describe('Attendance Scenario 2: Controlled Clock Lifecycle (09:30 Check-In and 17:00 Check-Out)', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('should correctly process 09:30 IST check-in and 17:00 IST check-out with late and early departure tracking', async () => {
      jest.useFakeTimers();
      const testDate = '2026-10-15';

      try {
        // Step 1: 09:30:00 IST Check-In (04:00:00 UTC)
        // Shift is 09:00-18:00 IST with 15-min grace (grace ends at 09:15:00 IST)
        const checkInUtc = new Date(`${testDate}T04:00:00.000Z`);
        jest.setSystemTime(checkInUtc);

        const kolkataBranch = {
          ...mockBranch,
          timezone: 'Asia/Kolkata',
        };

        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        branchRepo.findById.mockResolvedValue(kolkataBranch);
        shiftService.resolveShift.mockResolvedValue(mockShift);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        let activeRecord: AttendanceLean;
        attendanceRepo.create.mockImplementation((data) => {
          activeRecord = {
            ...mockAttendance,
            ...data,
            _id: new Types.ObjectId(),
            checkInTime: checkInUtc,
            checkOutTime: null,
            breaks: [],
            status: AttendanceStatus.CHECKED_IN,
          };
          return Promise.resolve(activeRecord);
        });

        const checkInResponse = await service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        // Assertions for 09:30 Check-In:
        // 1. Attendance date must be 2026-10-15 in Asia/Kolkata
        expect(checkInResponse.attendanceDate).toBe(testDate);
        expect(checkInResponse.status).toBe(AttendanceStatus.CHECKED_IN);
        // 2. Late calculation: 09:30 is past 09:15 grace limit -> isLate = true
        // calculateLate uses standard threshold model (diff from shiftStart 09:00) -> 30 minutes
        expect(checkInResponse.isLate).toBe(true);
        expect(checkInResponse.lateMinutes).toBe(30);

        expect(attendanceRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId,
            attendanceDate: testDate,
            checkInTime: checkInUtc,
            isLate: true,
            lateMinutes: 30,
            status: AttendanceStatus.CHECKED_IN,
          }),
          expect.anything(),
        );

        // Step 2: 17:00:00 IST Check-Out (11:30:00 UTC)
        // Advance clock by 7.5 hours (450 minutes gross elapsed)
        const checkOutUtc = new Date(`${testDate}T11:30:00.000Z`);
        jest.setSystemTime(checkOutUtc);

        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(activeRecord!);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          activeRecord!,
        );

        attendanceRepo.checkOutSession.mockImplementation((_id, updateData) => {
          const finishedRecord = {
            ...activeRecord!,
            ...updateData,
            _id: activeRecord!._id,
          } as AttendanceLean;
          return Promise.resolve(finishedRecord);
        });

        const checkOutResponse = await service.checkOut(
          actorUserId,
          {},
          clientMetadata,
        );

        // Assertions for 17:00 Check-Out:
        // 3. Break deduction: No break sessions were recorded (breaks = []).
        // Scheduled shift breakDurationMinutes (60 min) is NOT deducted automatically;
        // only actual recorded breaks are deducted -> totalBreakMinutes = 0
        expect(checkOutResponse.totalBreakMinutes).toBe(0);

        // 4. Total work minutes: Gross duration (09:30 to 17:00 = 450 min) - Breaks (0 min) = 450 min
        expect(checkOutResponse.totalWorkMinutes).toBe(450);

        // 5. Early departure: 17:00 check-out vs 18:00 shift end -> 60 minutes early
        expect(checkOutResponse.isEarlyDeparture).toBe(true);
        expect(checkOutResponse.earlyDepartureMinutes).toBe(60);

        // 6. Overtime minutes: 450 min is below overtimeThresholdMinutes (480) -> 0
        expect(checkOutResponse.overtimeMinutes).toBe(0);

        // 7. Attendance status: 450 min < 480 min (full-day threshold) and >= 240 min (half-day threshold)
        // -> Status is HALF_DAY
        expect(checkOutResponse.status).toBe(AttendanceStatus.HALF_DAY);

        expect(attendanceRepo.checkOutSession).toHaveBeenCalledWith(
          activeRecord!._id,
          expect.objectContaining({
            checkOutTime: checkOutUtc,
            totalWorkMinutes: 450,
            totalBreakMinutes: 0,
            isEarlyDeparture: true,
            earlyDepartureMinutes: 60,
            overtimeMinutes: 0,
            status: AttendanceStatus.HALF_DAY,
          }),
          expect.anything(),
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('Attendance Scenario 3: Approved Full-Day Leave Collision Guard', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('should reject check-in with 409 Conflict, preserve approved leave, and not overwrite ON_LEAVE record', async () => {
      jest.useFakeTimers();
      const testDate = '2026-10-15';

      try {
        // Set clock to 09:30:00 IST on 2026-10-15 (04:00:00 UTC)
        const checkInUtc = new Date(`${testDate}T04:00:00.000Z`);
        jest.setSystemTime(checkInUtc);

        const kolkataBranch = {
          ...mockBranch,
          timezone: 'Asia/Kolkata',
        };

        // 1. Active employee with assigned shift
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        branchRepo.findById.mockResolvedValue(kolkataBranch);
        shiftService.resolveShift.mockResolvedValue(mockShift);

        // 2. Approved full-day LeaveRequest for testDate
        const leaveReqId = new Types.ObjectId();
        const approvedLeaveRequest = {
          _id: leaveReqId,
          employeeId,
          leaveTypeId: new Types.ObjectId(),
          startDate: testDate,
          endDate: testDate,
          totalDays: 1,
          isHalfDay: false,
          halfDaySession: null,
          status: LeaveRequestStatus.APPROVED,
          reason: 'Personal full-day leave',
        } as unknown as LeaveRequestLean;
        leaveRequestRepo.findById.mockResolvedValue(approvedLeaveRequest);

        // 3. Corresponding attendance record synchronized as ON_LEAVE (checkInTime: null)
        const synchronizedAttendance: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId,
          attendanceDate: testDate,
          date: new Date(`${testDate}T00:00:00.000Z`),
          shiftId: mockShift._id,
          shiftSnapshot: {
            name: mockShift.name,
            code: mockShift.code,
            startTime: mockShift.startTime,
            endTime: mockShift.endTime,
            isOvernight: mockShift.isOvernight,
            gracePeriodMinutes: mockShift.gracePeriodMinutes,
            minWorkMinutesForFullDay: mockShift.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay: mockShift.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes: mockShift.overtimeThresholdMinutes,
          },
          status: AttendanceStatus.ON_LEAVE,
          leaveRequestId: leaveReqId,
          checkInTime: null,
          checkOutTime: null,
          breaks: [],
        };
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(
          synchronizedAttendance,
        );
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        // 4. Attempt check-in using AttendanceService.checkIn()
        let caughtError: AppError | null = null;
        try {
          await service.checkIn(
            actorUserId,
            { workMode: WorkMode.OFFICE },
            clientMetadata,
          );
        } catch (err) {
          caughtError = err as AppError;
        }

        // 5. Verify rejection with expected conflict exception (HTTP 409)
        expect(caughtError).toBeInstanceOf(AppError);
        expect(caughtError?.code).toBe(ErrorCode.RESOURCE_ALREADY_EXISTS);
        expect(caughtError?.statusCode).toBe(HttpStatus.CONFLICT);
        expect(caughtError?.message).toBe(
          `Cannot check in: You have an approved full-day leave for today (${testDate}). If you reported to work, your leave must first be cancelled via the leave cancellation workflow.`,
        );

        // 6. Verify no new attendance session is created
        expect(attendanceRepo.create).not.toHaveBeenCalled();

        // 7. Verify the approved LeaveRequest remains unchanged
        expect(leaveRequestRepo.findById).toHaveBeenCalledWith(leaveReqId);
        expect(approvedLeaveRequest.status).toBe(LeaveRequestStatus.APPROVED);

        // 8. Verify the existing ON_LEAVE attendance record is not overwritten or mutated
        expect(attendanceRepo.updateById).not.toHaveBeenCalled();
        expect(
          attendanceRepo.updateCheckInForExistingLeave,
        ).not.toHaveBeenCalled();
        expect(attendanceRepo.checkOutSession).not.toHaveBeenCalled();
        expect(synchronizedAttendance.status).toBe(AttendanceStatus.ON_LEAVE);
        expect(synchronizedAttendance.checkInTime).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('Attendance Scenario 4: Approved Leave Cancellation Reconciliation', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('should reconcile attendance on leave cancellation, unblock check-in, and not treat cancelled leave as approved', async () => {
      jest.useFakeTimers();

      try {
        const leaveDate = '2026-10-15';
        const dayBefore = '2026-10-14';

        // Set clock to 2026-10-14 10:00:00 UTC (day before the approved leave)
        jest.setSystemTime(new Date(`${dayBefore}T10:00:00.000Z`));

        const kolkataBranch = {
          ...mockBranch,
          timezone: 'Asia/Kolkata',
        };

        // 1. Create active employee with assigned shift
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        employeeRepo.findById.mockResolvedValue(mockEmployee);
        branchRepo.findById.mockResolvedValue(kolkataBranch);
        shiftService.resolveShift.mockResolvedValue(mockShift);

        // 2. Create an approved full-day LeaveRequest
        const leaveReqId = new Types.ObjectId();
        const leaveTypeId = new Types.ObjectId();
        let currentLeaveRequest: LeaveRequestLean = {
          _id: leaveReqId,
          employeeId,
          leaveTypeId,
          startDate: leaveDate,
          endDate: leaveDate,
          totalDays: 1,
          yearBreakdown: [{ year: 2026, days: 1 }],
          isHalfDay: false,
          halfDaySession: null,
          status: LeaveRequestStatus.APPROVED,
          reason: 'Scheduled vacation',
          approvalTimeline: [],
        } as unknown as LeaveRequestLean;

        leaveRequestRepo.findById.mockImplementation(
          (id: Types.ObjectId | string) => {
            if (id.toString() === leaveReqId.toString()) {
              return Promise.resolve(currentLeaveRequest);
            }
            return Promise.resolve(null);
          },
        );

        leaveRequestRepo.updateStatus.mockImplementation(
          (
            _id: Types.ObjectId | string,
            _from: LeaveRequestStatus | LeaveRequestStatus[],
            toStatus: LeaveRequestStatus,
            timeline: ApprovalTimelineEntry,
            extra?: Record<string, unknown>,
          ) => {
            currentLeaveRequest = {
              ...currentLeaveRequest,
              status: toStatus,
              cancellationReason: extra?.cancellationReason as
                string | undefined,
              approvalTimeline: [
                ...(currentLeaveRequest.approvalTimeline || []),
                timeline,
              ],
            };
            return Promise.resolve(currentLeaveRequest);
          },
        );

        // 3. Create synchronized attendance record with status: ON_LEAVE, checkInTime: null, checkOutTime: null, leaveRequestId: valid ID
        let currentAttendance: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId,
          attendanceDate: leaveDate,
          date: new Date(`${leaveDate}T00:00:00.000Z`),
          shiftId: mockShift._id,
          shiftSnapshot: {
            name: mockShift.name,
            code: mockShift.code,
            startTime: mockShift.startTime,
            endTime: mockShift.endTime,
            isOvernight: mockShift.isOvernight,
            gracePeriodMinutes: mockShift.gracePeriodMinutes,
            minWorkMinutesForFullDay: mockShift.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay: mockShift.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes: mockShift.overtimeThresholdMinutes,
          },
          status: AttendanceStatus.ON_LEAVE,
          leaveRequestId: leaveReqId,
          checkInTime: null,
          checkOutTime: null,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
          deletedAt: null,
        };

        attendanceRepo.findByEmployeeAndDate.mockImplementation(
          (_empId: Types.ObjectId, dateStr: string) => {
            if (dateStr === leaveDate && !currentAttendance.deletedAt) {
              return Promise.resolve(currentAttendance);
            }
            return Promise.resolve(null);
          },
        );

        attendanceRepo.removeFutureLeaveAttendance.mockImplementation(
          (reqId: Types.ObjectId, currentDate: string) => {
            if (
              currentAttendance.leaveRequestId?.toString() ===
                reqId.toString() &&
              currentAttendance.attendanceDate > currentDate
            ) {
              currentAttendance = {
                ...currentAttendance,
                deletedAt: new Date(),
              };
            }
            return Promise.resolve();
          },
        );

        const mockLeaveBalanceRepo = {
          creditCancelledBalance: jest.fn().mockResolvedValue({
            employeeId,
            leaveTypeId,
            year: 2026,
            usedDays: 0,
            availableBalance: 12,
          }),
        } as unknown as LeaveBalanceRepository;

        const mockLeaveTransactionRepo = {
          create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
        } as unknown as LeaveTransactionRepository;

        const mockLeaveTypeRepo = {
          findById: jest.fn(),
        } as unknown as LeaveTypeRepository;

        const mockCompOffRepo = {
          revertCompOffRedemption: jest.fn(),
        } as unknown as CompOffRepository;

        const leavesService = new LeavesService(
          mockLeaveTypeRepo,
          holidayRepo,
          mockLeaveBalanceRepo,
          leaveRequestRepo,
          mockLeaveTransactionRepo,
          mockCompOffRepo,
          employeeRepo,
          branchRepo,
          attendanceRepo,
          shiftService,
          auditLogsService,
          authorizationService,
          mockConnection as unknown as Connection,
        );

        // 4. Cancel the approved leave through the existing Leave cancellation workflow
        const cancelResult = await leavesService.cancelLeave(
          actorUserId,
          leaveReqId,
          { reason: 'Trip cancelled, reporting to office' },
          clientMetadata,
        );

        // 5. Verify attendance reconciliation follows actual production business rules:
        // - LeaveRequest status becomes CANCELLED
        expect(cancelResult.status).toBe(LeaveRequestStatus.CANCELLED);
        expect(currentLeaveRequest.status).toBe(LeaveRequestStatus.CANCELLED);
        expect(currentLeaveRequest.cancellationReason).toBe(
          'Trip cancelled, reporting to office',
        );

        // - Leave balance reservation/reversal follows existing cancellation workflow
        expect(
          mockLeaveBalanceRepo.creditCancelledBalance,
        ).toHaveBeenCalledWith(
          employeeId,
          leaveTypeId,
          2026,
          1,
          actorUserId,
          expect.anything(),
        );
        expect(mockLeaveTransactionRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId,
            leaveTypeId,
            year: 2026,
            transactionType: LeaveTransactionType.CANCELLATION_CREDIT,
            days: 1,
            referenceId: leaveReqId,
            referenceType: 'LeaveRequest',
            actorId: actorUserId,
          }),
          expect.anything(),
        );

        // - Attendance record is reconciled correctly (removeFutureLeaveAttendance called and marked deleted)
        expect(attendanceRepo.removeFutureLeaveAttendance).toHaveBeenCalledWith(
          leaveReqId,
          dayBefore,
          expect.anything(),
        );
        expect(currentAttendance.deletedAt).toBeInstanceOf(Date);

        // 6. Verify: A cancelled leave does not continue blocking future check-in
        // Advance clock to the leave date at 09:00 IST (03:30 UTC)
        const checkInTimeUtc = new Date(`${leaveDate}T03:30:00.000Z`);
        jest.setSystemTime(checkInTimeUtc);

        // Sub-case A: Fresh check-in after attendance reconciliation (record was soft-deleted)
        const createdAttendance: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId,
          attendanceDate: leaveDate,
          checkInTime: checkInTimeUtc,
          status: AttendanceStatus.CHECKED_IN,
          leaveRequestId: null,
          deletedAt: null,
        };
        attendanceRepo.create.mockResolvedValue(createdAttendance);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        const checkInResult = await service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );
        expect(checkInResult).toBeDefined();
        expect(checkInResult.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(attendanceRepo.create).toHaveBeenCalled();

        // 7. Verify: No stale leaveRequestId causes the cancelled leave to be treated as approved,
        // and existing attendance history is not incorrectly overwritten
        currentAttendance = {
          ...currentAttendance,
          deletedAt: null, // Record still present in DB (e.g. unpunched pre-created record)
          checkInTime: null,
          checkOutTime: null,
          status: AttendanceStatus.ON_LEAVE,
          leaveRequestId: leaveReqId, // Retains reference to CANCELLED leave request
        };
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(
          currentAttendance,
        );
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        const checkedInRecord: AttendanceLean = {
          ...currentAttendance,
          checkInTime: checkInTimeUtc,
          status: AttendanceStatus.CHECKED_IN,
        };
        attendanceRepo.updateCheckInForExistingLeave.mockResolvedValue(
          checkedInRecord,
        );

        // Attempt check-in on existing record linked to cancelled leave
        const unblockedCheckIn = await service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        // Must succeed without throwing 409 Conflict
        expect(unblockedCheckIn).toBeDefined();
        expect(unblockedCheckIn.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(
          attendanceRepo.updateCheckInForExistingLeave,
        ).toHaveBeenCalledWith(
          currentAttendance._id,
          expect.objectContaining({
            checkInTime: checkInTimeUtc,
            status: AttendanceStatus.CHECKED_IN,
          }),
          expect.anything(),
        );

        // 8. Verify check-out: cancelled leave does NOT truncate/downgrade full-day to HALF_DAY
        // Advance clock to 18:00 IST (12:30 UTC) -> 9.0 hours (540 minutes) of work
        const checkOutTimeUtc = new Date(`${leaveDate}T12:30:00.000Z`);
        jest.setSystemTime(checkOutTimeUtc);

        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          checkedInRecord,
        );
        attendanceRepo.checkOutSession.mockImplementation((_id, data) =>
          Promise.resolve({
            ...checkedInRecord,
            ...data,
            checkOutTime: checkOutTimeUtc,
            status: data.status as AttendanceStatus,
          } as AttendanceLean),
        );

        const checkOutResult = await service.checkOut(
          actorUserId,
          {},
          clientMetadata,
        );

        // Status must be PRESENT, not HALF_DAY, confirming no stale leave degradation
        expect(checkOutResult.status).toBe(AttendanceStatus.PRESENT);
        expect(attendanceRepo.checkOutSession).toHaveBeenCalledWith(
          checkedInRecord._id,
          expect.objectContaining({
            checkOutTime: checkOutTimeUtc,
            totalWorkMinutes: 540,
            status: AttendanceStatus.PRESENT,
          }),
          expect.anything(),
        );

        // Existing shift history snapshot preserved
        expect(checkedInRecord.shiftSnapshot.startTime).toBe(
          mockShift.startTime,
        );
        expect(checkedInRecord.shiftSnapshot.endTime).toBe(mockShift.endTime);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('Attendance Scenario 5: Half-Day Approved Leave', () => {
    const testDate = '2026-10-15';
    const kolkataBranch = {
      ...mockBranch,
      timezone: 'Asia/Kolkata',
    };

    afterEach(() => {
      jest.useRealTimers();
    });

    it('Case A — First-Half Leave: should reject check-in before second-half start, allow check-in during second half, update ON_LEAVE atomically, and cap checkout to HALF_DAY', async () => {
      jest.useFakeTimers();

      try {
        // Shift is 09:00–18:00 IST (03:30 to 12:30 UTC), midpoint is 13:30 IST (08:00 UTC).
        // First-half leave: 09:00–13:30 IST. Permitted working session: 13:30–18:00 IST.
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        branchRepo.findById.mockResolvedValue(kolkataBranch);
        shiftService.resolveShift.mockResolvedValue(mockShift);

        const leaveReqId = new Types.ObjectId();
        const firstHalfLeaveRequest = {
          _id: leaveReqId,
          employeeId,
          leaveTypeId: new Types.ObjectId(),
          startDate: testDate,
          endDate: testDate,
          totalDays: 0.5,
          isHalfDay: true,
          halfDaySession: HalfDaySession.FIRST_HALF,
          status: LeaveRequestStatus.APPROVED,
          reason: 'Doctor appointment morning',
        } as unknown as LeaveRequestLean;

        leaveRequestRepo.findById.mockResolvedValue(firstHalfLeaveRequest);

        // Pre-created synchronized attendance record with status: ON_LEAVE
        const synchronizedAttendance: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId,
          attendanceDate: testDate,
          date: new Date(`${testDate}T00:00:00.000Z`),
          shiftId: mockShift._id,
          shiftSnapshot: {
            name: mockShift.name,
            code: mockShift.code,
            startTime: mockShift.startTime,
            endTime: mockShift.endTime,
            isOvernight: mockShift.isOvernight,
            gracePeriodMinutes: mockShift.gracePeriodMinutes,
            minWorkMinutesForFullDay: mockShift.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay: mockShift.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes: mockShift.overtimeThresholdMinutes,
          },
          status: AttendanceStatus.ON_LEAVE,
          leaveRequestId: leaveReqId,
          checkInTime: null,
          checkOutTime: null,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
          isLate: false,
          lateMinutes: 0,
          deletedAt: null,
        };

        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(
          synchronizedAttendance,
        );
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        // 1. Verify check-in before the permitted work window is rejected
        // 10:00 IST = 04:30 UTC (< 08:00 UTC midpoint)
        const earlyPunchUtc = new Date(`${testDate}T04:30:00.000Z`);
        jest.setSystemTime(earlyPunchUtc);

        let earlyError: AppError | null = null;
        try {
          await service.checkIn(
            actorUserId,
            { workMode: WorkMode.OFFICE },
            clientMetadata,
          );
        } catch (err) {
          earlyError = err as AppError;
        }

        expect(earlyError).toBeInstanceOf(AppError);
        expect(earlyError?.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(earlyError?.statusCode).toBe(HttpStatus.BAD_REQUEST);
        expect(earlyError?.message).toMatch(
          /Cannot check in during your approved first-half leave period/i,
        );

        // Verify no attendance updates or duplicate records were created
        expect(
          attendanceRepo.updateCheckInForExistingLeave,
        ).not.toHaveBeenCalled();
        expect(attendanceRepo.create).not.toHaveBeenCalled();

        // 2. Verify check-in during permitted second-half window succeeds
        // 13:35 IST = 08:05 UTC (second-half start: 13:30 IST, within 15-min grace -> isLate = false)
        const permittedCheckInUtc = new Date(`${testDate}T08:05:00.000Z`);
        jest.setSystemTime(permittedCheckInUtc);

        const checkedInRecord: AttendanceLean = {
          ...synchronizedAttendance,
          checkInTime: permittedCheckInUtc,
          status: AttendanceStatus.CHECKED_IN,
        };
        attendanceRepo.updateCheckInForExistingLeave.mockResolvedValue(
          checkedInRecord,
        );

        const checkInResult = await service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        // 3. Verify correct attendance date, leave reference, and status
        expect(checkInResult).toBeDefined();
        expect(checkInResult.attendanceDate).toBe(testDate);
        expect(checkInResult.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(
          attendanceRepo.updateCheckInForExistingLeave,
        ).toHaveBeenCalledWith(
          synchronizedAttendance._id,
          expect.objectContaining({
            checkInTime: permittedCheckInUtc,
            status: AttendanceStatus.CHECKED_IN,
            leaveRequestId: leaveReqId, // Preserves leave reference
            isLate: false,
            lateMinutes: 0,
          }),
          expect.anything(),
        );

        // 4. Verify no duplicate attendance record is created
        expect(attendanceRepo.create).not.toHaveBeenCalled();

        // 5. Verify checkout does not incorrectly convert approved half-day leave into full-day PRESENT
        // Employee stays late until 22:35 IST = 17:05 UTC (9.0 hours = 540 min >= 480 min threshold)
        const lateCheckOutUtc = new Date(`${testDate}T17:05:00.000Z`);
        jest.setSystemTime(lateCheckOutUtc);

        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          checkedInRecord,
        );
        attendanceRepo.checkOutSession.mockImplementation((_id, data) =>
          Promise.resolve({
            ...checkedInRecord,
            ...data,
            checkOutTime: lateCheckOutUtc,
            status: data.status as AttendanceStatus,
          } as AttendanceLean),
        );

        const checkOutResult = await service.checkOut(
          actorUserId,
          {},
          clientMetadata,
        );

        // Status must be capped to HALF_DAY despite 540 worked minutes
        expect(checkOutResult.status).toBe(AttendanceStatus.HALF_DAY);
        expect(attendanceRepo.checkOutSession).toHaveBeenCalledWith(
          checkedInRecord._id,
          expect.objectContaining({
            checkOutTime: lateCheckOutUtc,
            totalWorkMinutes: 540,
            status: AttendanceStatus.HALF_DAY,
          }),
          expect.anything(),
        );

        // History preserved
        expect(checkedInRecord.shiftSnapshot.startTime).toBe(
          mockShift.startTime,
        );
        expect(checkedInRecord.shiftSnapshot.endTime).toBe(mockShift.endTime);
      } finally {
        jest.useRealTimers();
      }
    });

    it('Case B — Second-Half Leave: should reject check-in during second half, allow check-in during first half, update ON_LEAVE atomically, and cap checkout to HALF_DAY', async () => {
      jest.useFakeTimers();

      try {
        // Shift is 09:00–18:00 IST (03:30 to 12:30 UTC), midpoint is 13:30 IST (08:00 UTC).
        // Second-half leave: 13:30–18:00 IST. Permitted working session: 09:00–13:30 IST.
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
        branchRepo.findById.mockResolvedValue(kolkataBranch);
        shiftService.resolveShift.mockResolvedValue(mockShift);

        const leaveReqId = new Types.ObjectId();
        const secondHalfLeaveRequest = {
          _id: leaveReqId,
          employeeId,
          leaveTypeId: new Types.ObjectId(),
          startDate: testDate,
          endDate: testDate,
          totalDays: 0.5,
          isHalfDay: true,
          halfDaySession: HalfDaySession.SECOND_HALF,
          status: LeaveRequestStatus.APPROVED,
          reason: 'Family event afternoon',
        } as unknown as LeaveRequestLean;

        leaveRequestRepo.findById.mockResolvedValue(secondHalfLeaveRequest);

        // Pre-created synchronized attendance record with status: ON_LEAVE
        const synchronizedAttendance: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId,
          attendanceDate: testDate,
          date: new Date(`${testDate}T00:00:00.000Z`),
          shiftId: mockShift._id,
          shiftSnapshot: {
            name: mockShift.name,
            code: mockShift.code,
            startTime: mockShift.startTime,
            endTime: mockShift.endTime,
            isOvernight: mockShift.isOvernight,
            gracePeriodMinutes: mockShift.gracePeriodMinutes,
            minWorkMinutesForFullDay: mockShift.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay: mockShift.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes: mockShift.overtimeThresholdMinutes,
          },
          status: AttendanceStatus.ON_LEAVE,
          leaveRequestId: leaveReqId,
          checkInTime: null,
          checkOutTime: null,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
          isLate: false,
          lateMinutes: 0,
          deletedAt: null,
        };

        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(
          synchronizedAttendance,
        );
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        // 1. Verify check-in during second half (outside permitted window) is rejected
        // 14:00 IST = 08:30 UTC (>= 08:00 UTC midpoint)
        const latePunchUtc = new Date(`${testDate}T08:30:00.000Z`);
        jest.setSystemTime(latePunchUtc);

        let lateError: AppError | null = null;
        try {
          await service.checkIn(
            actorUserId,
            { workMode: WorkMode.OFFICE },
            clientMetadata,
          );
        } catch (err) {
          lateError = err as AppError;
        }

        expect(lateError).toBeInstanceOf(AppError);
        expect(lateError?.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(lateError?.statusCode).toBe(HttpStatus.BAD_REQUEST);
        expect(lateError?.message).toMatch(
          /Cannot check in during your approved second-half leave period/i,
        );

        // Verify no attendance updates or duplicate records were created
        expect(
          attendanceRepo.updateCheckInForExistingLeave,
        ).not.toHaveBeenCalled();
        expect(attendanceRepo.create).not.toHaveBeenCalled();

        // 2. Verify check-in during permitted first-half window succeeds
        // 09:05 IST = 03:35 UTC (< 08:00 UTC midpoint, within 15-min grace -> isLate = false)
        const permittedCheckInUtc = new Date(`${testDate}T03:35:00.000Z`);
        jest.setSystemTime(permittedCheckInUtc);

        const checkedInRecord: AttendanceLean = {
          ...synchronizedAttendance,
          checkInTime: permittedCheckInUtc,
          status: AttendanceStatus.CHECKED_IN,
        };
        attendanceRepo.updateCheckInForExistingLeave.mockResolvedValue(
          checkedInRecord,
        );

        const checkInResult = await service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        // 3. Verify correct attendance date, leave reference, and status
        expect(checkInResult).toBeDefined();
        expect(checkInResult.attendanceDate).toBe(testDate);
        expect(checkInResult.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(
          attendanceRepo.updateCheckInForExistingLeave,
        ).toHaveBeenCalledWith(
          synchronizedAttendance._id,
          expect.objectContaining({
            checkInTime: permittedCheckInUtc,
            status: AttendanceStatus.CHECKED_IN,
            leaveRequestId: leaveReqId, // Preserves leave reference
            isLate: false,
            lateMinutes: 0,
          }),
          expect.anything(),
        );

        // 4. Verify no duplicate attendance record is created
        expect(attendanceRepo.create).not.toHaveBeenCalled();

        // 5. Verify checkout does not incorrectly convert approved half-day leave into full-day PRESENT
        // Employee stays until 18:05 IST = 12:35 UTC (9.0 hours = 540 min >= 480 min threshold)
        const checkOutUtc = new Date(`${testDate}T12:35:00.000Z`);
        jest.setSystemTime(checkOutUtc);

        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          checkedInRecord,
        );
        attendanceRepo.checkOutSession.mockImplementation((_id, data) =>
          Promise.resolve({
            ...checkedInRecord,
            ...data,
            checkOutTime: checkOutUtc,
            status: data.status as AttendanceStatus,
          } as AttendanceLean),
        );

        const checkOutResult = await service.checkOut(
          actorUserId,
          {},
          clientMetadata,
        );

        // Status must be capped to HALF_DAY despite 540 worked minutes
        expect(checkOutResult.status).toBe(AttendanceStatus.HALF_DAY);
        expect(attendanceRepo.checkOutSession).toHaveBeenCalledWith(
          checkedInRecord._id,
          expect.objectContaining({
            checkOutTime: checkOutUtc,
            totalWorkMinutes: 540,
            status: AttendanceStatus.HALF_DAY,
          }),
          expect.anything(),
        );

        // History preserved
        expect(checkedInRecord.shiftSnapshot.startTime).toBe(
          mockShift.startTime,
        );
        expect(checkedInRecord.shiftSnapshot.endTime).toBe(mockShift.endTime);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('Attendance Scenario 6: Weekly Off Handling', () => {
    // Branch IDs
    const bangaloreBranchId = new Types.ObjectId();
    const delhiBranchId = new Types.ObjectId();

    // Branches
    const bangaloreBranch: Branch = {
      ...mockBranch,
      _id: bangaloreBranchId,
      name: 'Bangalore Headquarters',
      timezone: 'Asia/Kolkata',
    } as unknown as Branch;

    const delhiBranch: Branch = {
      ...mockBranch,
      _id: delhiBranchId,
      name: 'Delhi Regional Office',
      timezone: 'Asia/Kolkata',
    } as unknown as Branch;

    // Employees
    const blrEmployeeUserId = new Types.ObjectId();
    const blrEmployeeId = new Types.ObjectId();
    const mockBlrEmployee: EmployeeLean = {
      ...mockEmployee,
      _id: blrEmployeeId,
      userId: blrEmployeeUserId,
      branchId: bangaloreBranchId,
    };

    const delEmployeeUserId = new Types.ObjectId();
    const delEmployeeId = new Types.ObjectId();
    const mockDelEmployee: EmployeeLean = {
      ...mockEmployee,
      _id: delEmployeeId,
      userId: delEmployeeUserId,
      branchId: delhiBranchId,
    };

    // In-memory store for weekly off configs
    const weeklyOffConfigsStore = new Map<string, WeeklyOffConfigLean>();
    let weeklyOffRepo: jest.Mocked<WeeklyOffConfigRepository>;
    let weeklyOffService: WeeklyOffService;
    let scenarioService: AttendanceService;

    // Config IDs
    const companyConfigId = new Types.ObjectId();
    const bangaloreConfigId = new Types.ObjectId();

    beforeEach(() => {
      weeklyOffConfigsStore.clear();

      // 1. Company-wide default configuration: Only Sunday is weekly off (Saturdays are working)
      const companyConfig = {
        _id: companyConfigId,
        name: 'Company Default Weekly Off',
        description: 'Sunday Weekly Off Org-Wide',
        branchId: null,
        days: [
          {
            dayOfWeek: DayOfWeek.SUNDAY,
            occurrences: [
              WeekOccurrence.FIRST,
              WeekOccurrence.SECOND,
              WeekOccurrence.THIRD,
              WeekOccurrence.FOURTH,
              WeekOccurrence.FIFTH,
            ],
          },
        ],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
        createdBy: actorUserId,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      } as unknown as WeeklyOffConfigLean;
      weeklyOffConfigsStore.set('company', companyConfig);

      // 2. Bangalore Branch Override: Every Sunday + 2nd and 4th Saturday off
      const bangaloreConfig = {
        _id: bangaloreConfigId,
        name: 'Bangalore Branch Weekly Off',
        description: 'Sunday and Alternate Saturday Off for Bangalore',
        branchId: bangaloreBranchId,
        days: [
          {
            dayOfWeek: DayOfWeek.SUNDAY,
            occurrences: [
              WeekOccurrence.FIRST,
              WeekOccurrence.SECOND,
              WeekOccurrence.THIRD,
              WeekOccurrence.FOURTH,
              WeekOccurrence.FIFTH,
            ],
          },
          {
            dayOfWeek: DayOfWeek.SATURDAY,
            occurrences: [WeekOccurrence.SECOND, WeekOccurrence.FOURTH],
          },
        ],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
        createdBy: actorUserId,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      } as unknown as WeeklyOffConfigLean;
      weeklyOffConfigsStore.set(bangaloreBranchId.toString(), bangaloreConfig);

      // WeeklyOffConfigRepository mock matching production query contract
      weeklyOffRepo = {
        findEffectiveConfig: jest.fn(
          (_date: string, branchId?: Types.ObjectId | null) => {
            const key = branchId ? branchId.toString() : 'company';
            const config = weeklyOffConfigsStore.get(key);
            if (!config || !config.isActive) return Promise.resolve(null);
            if (_date < config.effectiveFrom) return Promise.resolve(null);
            if (config.effectiveTo && _date > config.effectiveTo)
              return Promise.resolve(null);
            return Promise.resolve(config);
          },
        ),
      } as unknown as jest.Mocked<WeeklyOffConfigRepository>;

      // Instantiate real WeeklyOffService with repo mock
      weeklyOffService = new WeeklyOffService(
        weeklyOffRepo,
        branchRepo,
        auditLogsService,
        mockConnection as unknown as Connection,
      );

      // Construct AttendanceService instance with real WeeklyOffService wired
      scenarioService = new AttendanceService(
        attendanceRepo,
        regularizationRepo,
        employeeRepo,
        branchRepo,
        shiftService,
        auditLogsService,
        authorizationService,
        mockConnection as unknown as Connection,
        weeklyOffService,
        leaveRequestRepo,
        holidayRepo,
      );

      // Branch repository resolver
      shiftService.resolveShift.mockResolvedValue(mockShift);

      branchRepo.findById.mockImplementation((id: Types.ObjectId | string) => {
        const idStr = id.toString();
        if (idStr === bangaloreBranchId.toString())
          return Promise.resolve(bangaloreBranch);
        if (idStr === delhiBranchId.toString())
          return Promise.resolve(delhiBranch);
        return Promise.resolve(mockBranch);
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('TC-WO-01: Configured weekly-off date is correctly identified via branch rules and blocks regularization', async () => {
      // 2026-10-10 is the 2nd Saturday of October 2026
      const isBlrSecondSatOff = await weeklyOffService.isWeeklyOff(
        '2026-10-10',
        bangaloreBranchId,
      );
      expect(isBlrSecondSatOff).toBe(true);

      const effectiveConfig = await weeklyOffService.getEffectiveConfig(
        '2026-10-10',
        bangaloreBranchId,
      );
      expect(effectiveConfig.isWeeklyOff).toBe(true);
      expect(effectiveConfig.source).toBe('BRANCH_OVERRIDE');
      expect(effectiveConfig.configuration?.name).toBe(
        'Bangalore Branch Weekly Off',
      );

      // Sunday 2026-10-11 is also a weekly off
      const isBlrSunOff = await weeklyOffService.isWeeklyOff(
        '2026-10-11',
        bangaloreBranchId,
      );
      expect(isBlrSunOff).toBe(true);

      // Verify AttendanceService.createRegularization recognizes this weekly off and rejects with HTTP 400
      jest.useFakeTimers();
      try {
        // Today is 2026-10-15T09:00:00.000Z (within 7-day SLA window from 2026-10-10)
        jest.setSystemTime(new Date('2026-10-15T03:30:00.000Z'));

        employeeRepo.findByUserId.mockResolvedValue(mockBlrEmployee);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

        await expect(
          scenarioService.createRegularization(
            blrEmployeeUserId,
            {
              attendanceDate: '2026-10-10',
              requestedCheckInTime: '2026-10-10T03:30:00.000Z',
              requestedCheckOutTime: '2026-10-10T12:30:00.000Z',
              reason: 'Missed punch on 2nd Saturday',
            },
            clientMetadata,
          ),
        ).rejects.toThrow(
          'Cannot regularize attendance on a weekly off (2026-10-10). Regularization is only permitted on scheduled working days. Please submit a Comp-Off or Overtime request instead.',
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-WO-02: Unworked weekly-off date does not result in an ABSENT attendance record (Attendance Finalization Gap Audit)', async () => {
      // Setup: 2026-10-10 is a configured weekly off. The employee did not work or punch in.
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

      // Verify no record exists for this unpunched weekly off
      const record = await attendanceRepo.findByEmployeeAndDate(
        blrEmployeeId,
        '2026-10-10',
      );
      expect(record).toBeNull();

      // Audit Verification: In the production codebase, there is NO automated attendance
      // finalization scheduler or cron (no finalizeAttendance or markAbsent batch job).
      // Weekly offs remain unrecorded and are NEVER automatically populated as AttendanceStatus.ABSENT.
      expect(record?.status).toBeUndefined();
    });

    it('TC-WO-03: Attempt check-in on weekly off — verifies production behavior where checkIn() ignores weekly-off configuration and allows punch-in', async () => {
      // Policy Gap Audit:
      // Production AttendanceService.checkIn() does NOT invoke WeeklyOffService.isWeeklyOff().
      // Unlike createRegularization() which enforces Guard 5, checkIn() does not restrict employees
      // from checking in on configured weekly-off dates.
      jest.useFakeTimers();
      try {
        const weeklyOffDate = '2026-10-10'; // 2nd Saturday
        const punchInTimeUtc = new Date(`${weeklyOffDate}T04:00:00.000Z`); // 09:30 IST
        jest.setSystemTime(punchInTimeUtc);

        employeeRepo.findByUserId.mockResolvedValue(mockBlrEmployee);
        branchRepo.findById.mockResolvedValue(bangaloreBranch);
        shiftService.resolveShift.mockResolvedValue(mockShift);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        const createdDoc: AttendanceLean = {
          _id: new Types.ObjectId(),
          employeeId: blrEmployeeId,
          attendanceDate: weeklyOffDate,
          date: new Date('2026-10-10T00:00:00.000Z'),
          shiftId,
          shiftSnapshot: {
            name: mockShift.name,
            code: mockShift.code,
            startTime: mockShift.startTime,
            endTime: mockShift.endTime,
            isOvernight: mockShift.isOvernight,
            gracePeriodMinutes: mockShift.gracePeriodMinutes,
            minWorkMinutesForFullDay: mockShift.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay: mockShift.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes: mockShift.overtimeThresholdMinutes,
          },
          status: AttendanceStatus.CHECKED_IN,
          workMode: WorkMode.OFFICE,
          checkInTime: punchInTimeUtc,
          checkOutTime: null,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
          isLate: false,
          lateMinutes: 0,
          isEarlyDeparture: false,
          earlyDepartureMinutes: 0,
          overtimeMinutes: 0,
          checkInSource: AttendanceSource.WEB,
          checkInIp: '127.0.0.1',
          regularizationId: null,
          deletedAt: null,
          deletedBy: null,
          createdAt: punchInTimeUtc,
          updatedAt: punchInTimeUtc,
        };

        attendanceRepo.create.mockResolvedValue(createdDoc);

        const checkInResult = await scenarioService.checkIn(
          blrEmployeeUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        // Production check-in succeeds with CHECKED_IN because checkIn() lacks a weekly-off guard
        expect(checkInResult).toBeDefined();
        expect(checkInResult.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(checkInResult.attendanceDate).toBe(weeklyOffDate);
        expect(attendanceRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: blrEmployeeId,
            attendanceDate: weeklyOffDate,
            status: AttendanceStatus.CHECKED_IN,
            checkInTime: punchInTimeUtc,
          }),
          expect.anything(),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-WO-04: Checkout records actual worked duration and classifies status as PRESENT (compensation handled via Comp-Off)', async () => {
      jest.useFakeTimers();
      try {
        const weeklyOffDate = '2026-10-10';
        const checkInTimeUtc = new Date(`${weeklyOffDate}T03:30:00.000Z`); // 09:00 IST
        const checkOutTimeUtc = new Date(`${weeklyOffDate}T12:00:00.000Z`); // 17:30 IST (8.5 hours = 510 min)

        jest.setSystemTime(checkOutTimeUtc);

        employeeRepo.findByUserId.mockResolvedValue(mockBlrEmployee);
        branchRepo.findById.mockResolvedValue(bangaloreBranch);

        const activeSession: AttendanceLean = {
          _id: new Types.ObjectId(),
          employeeId: blrEmployeeId,
          attendanceDate: weeklyOffDate,
          date: new Date('2026-10-10T00:00:00.000Z'),
          shiftId,
          shiftSnapshot: {
            name: mockShift.name,
            code: mockShift.code,
            startTime: mockShift.startTime,
            endTime: mockShift.endTime,
            isOvernight: mockShift.isOvernight,
            gracePeriodMinutes: mockShift.gracePeriodMinutes,
            minWorkMinutesForFullDay: mockShift.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay: mockShift.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes: mockShift.overtimeThresholdMinutes,
          },
          status: AttendanceStatus.CHECKED_IN,
          workMode: WorkMode.OFFICE,
          checkInTime: checkInTimeUtc,
          checkOutTime: null,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
          isLate: false,
          lateMinutes: 0,
          isEarlyDeparture: false,
          earlyDepartureMinutes: 0,
          overtimeMinutes: 0,
          checkInSource: AttendanceSource.WEB,
          checkInIp: '127.0.0.1',
          regularizationId: null,
          deletedAt: null,
          deletedBy: null,
          createdAt: checkInTimeUtc,
          updatedAt: checkInTimeUtc,
        };

        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          activeSession,
        );
        attendanceRepo.checkOutSession.mockImplementation((_id, data) =>
          Promise.resolve({
            ...activeSession,
            ...data,
            checkOutTime: checkOutTimeUtc,
            status: data.status as AttendanceStatus,
          } as AttendanceLean),
        );

        const checkOutResult = await scenarioService.checkOut(
          blrEmployeeUserId,
          {},
          clientMetadata,
        );

        // Actual worked duration is 510 minutes
        expect(checkOutResult.totalWorkMinutes).toBe(510);
        // Production classification: status is PRESENT based on >= 480 min threshold.
        // It does NOT auto-convert to AttendanceStatus.WEEK_OFF.
        // In the system architecture, employees who work on weekly offs receive status PRESENT
        // and are eligible to claim compensatory off via CompOffService.claimCompOff().
        expect(checkOutResult.status).toBe(AttendanceStatus.PRESENT);

        expect(attendanceRepo.checkOutSession).toHaveBeenCalledWith(
          activeSession._id,
          expect.objectContaining({
            checkOutTime: checkOutTimeUtc,
            totalWorkMinutes: 510,
            status: AttendanceStatus.PRESENT,
          }),
          expect.anything(),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-WO-05: Non-weekly-off working day is not treated as a weekly off', async () => {
      // 2026-10-14 is Wednesday (standard working day)
      const isWedOff = await weeklyOffService.isWeeklyOff(
        '2026-10-14',
        bangaloreBranchId,
      );
      expect(isWedOff).toBe(false);

      const effectiveConfig = await weeklyOffService.getEffectiveConfig(
        '2026-10-14',
        bangaloreBranchId,
      );
      expect(effectiveConfig.isWeeklyOff).toBe(false);

      // Verify createRegularization succeeds for Wednesday 2026-10-14 (not blocked by Guard 5 weekly off)
      jest.useFakeTimers();
      try {
        // Today is Thursday 2026-10-15 (1 day past 2026-10-14, within 7-day SLA window)
        jest.setSystemTime(new Date('2026-10-15T03:30:00.000Z'));

        employeeRepo.findByUserId.mockResolvedValue(mockBlrEmployee);
        branchRepo.findById.mockResolvedValue(bangaloreBranch);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(null);

        const regId = new Types.ObjectId();
        regularizationRepo.create.mockImplementation((data) =>
          Promise.resolve({
            _id: regId,
            ...data,
            status: RegularizationStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as AttendanceRegularizationLean),
        );

        const regResponse = await scenarioService.createRegularization(
          blrEmployeeUserId,
          {
            attendanceDate: '2026-10-14',
            requestedCheckInTime: '2026-10-14T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-14T12:30:00.000Z',
            reason: 'Card reader offline on Wednesday',
          },
          clientMetadata,
        );

        expect(regResponse).toBeDefined();
        expect(regResponse.attendanceDate).toBe('2026-10-14');
        expect(regResponse.status).toBe(RegularizationStatus.PENDING);
        expect(regularizationRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: blrEmployeeId,
            attendanceDate: '2026-10-14',
          }),
          expect.anything(),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-WO-06: Branch-specific weekly-off configuration takes precedence over company defaults', async () => {
      // Date under test: 2026-10-10 (2nd Saturday of October 2026)
      // Bangalore Branch has override: 2nd Saturday is OFF
      const blrEffective = await weeklyOffService.getEffectiveConfig(
        '2026-10-10',
        bangaloreBranchId,
      );
      expect(blrEffective.isWeeklyOff).toBe(true);
      expect(blrEffective.source).toBe('BRANCH_OVERRIDE');
      expect(blrEffective.configuration?.name).toBe(
        'Bangalore Branch Weekly Off',
      );

      // Delhi Branch has NO override -> falls back to Company Default (where Saturday is a normal working day)
      const delEffective = await weeklyOffService.getEffectiveConfig(
        '2026-10-10',
        delhiBranchId,
      );
      expect(delEffective.isWeeklyOff).toBe(false);
      expect(delEffective.source).toBe('COMPANY_DEFAULT');
      expect(delEffective.configuration?.name).toBe(
        'Company Default Weekly Off',
      );

      // Cross-Branch Regularization Policy Enforcement:
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date('2026-10-15T03:30:00.000Z'));

        // 1. Bangalore employee is BLOCKED on 2026-10-10 due to branch weekly-off override
        employeeRepo.findByUserId.mockResolvedValue(mockBlrEmployee);
        branchRepo.findById.mockResolvedValue(bangaloreBranch);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

        await expect(
          scenarioService.createRegularization(
            blrEmployeeUserId,
            {
              attendanceDate: '2026-10-10',
              requestedCheckInTime: '2026-10-10T03:30:00.000Z',
              requestedCheckOutTime: '2026-10-10T12:30:00.000Z',
              reason: 'Bangalore employee swipe miss',
            },
            clientMetadata,
          ),
        ).rejects.toThrow(
          'Cannot regularize attendance on a weekly off (2026-10-10). Regularization is only permitted on scheduled working days. Please submit a Comp-Off or Overtime request instead.',
        );

        // 2. Delhi employee is ALLOWED on 2026-10-10 because Saturday is a normal working day under Company Default
        employeeRepo.findByUserId.mockResolvedValue(mockDelEmployee);
        branchRepo.findById.mockResolvedValue(delhiBranch);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(null);

        const delRegId = new Types.ObjectId();
        regularizationRepo.create.mockImplementation((data) =>
          Promise.resolve({
            _id: delRegId,
            ...data,
            status: RegularizationStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as AttendanceRegularizationLean),
        );

        const delRegResult = await scenarioService.createRegularization(
          delEmployeeUserId,
          {
            attendanceDate: '2026-10-10',
            requestedCheckInTime: '2026-10-10T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-10T12:30:00.000Z',
            reason: 'Delhi employee swipe miss on scheduled Saturday shift',
          },
          clientMetadata,
        );

        expect(delRegResult).toBeDefined();
        expect(delRegResult.attendanceDate).toBe('2026-10-10');
        expect(delRegResult.status).toBe(RegularizationStatus.PENDING);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('Attendance Scenario 7: Public Holiday Handling', () => {
    const bangaloreBranchId = new Types.ObjectId();
    const delhiBranchId = new Types.ObjectId();

    const bangaloreBranch: Branch = {
      ...mockBranch,
      _id: bangaloreBranchId,
      name: 'Bangalore Headquarters',
      timezone: 'Asia/Kolkata',
    } as unknown as Branch;

    const delhiBranch: Branch = {
      ...mockBranch,
      _id: delhiBranchId,
      name: 'Delhi Regional Office',
      timezone: 'Asia/Kolkata',
    } as unknown as Branch;

    const blrEmployeeUserId = new Types.ObjectId();
    const blrEmployeeId = new Types.ObjectId();
    const mockBlrEmployee: EmployeeLean = {
      ...mockEmployee,
      _id: blrEmployeeId,
      userId: blrEmployeeUserId,
      branchId: bangaloreBranchId,
    };

    const delEmployeeUserId = new Types.ObjectId();
    const delEmployeeId = new Types.ObjectId();
    const mockDelEmployee: EmployeeLean = {
      ...mockEmployee,
      _id: delEmployeeId,
      userId: delEmployeeUserId,
      branchId: delhiBranchId,
    };

    // Fixtures for holidays
    const gandhiJayantiHolidayId = new Types.ObjectId();
    const gandhiJayantiHoliday: HolidayLean = {
      _id: gandhiJayantiHolidayId,
      name: 'Gandhi Jayanti',
      date: '2026-10-02',
      year: 2026,
      type: HolidayType.PUBLIC,
      branchId: null, // Organization-wide
      description: 'National Public Holiday',
      isActive: true,
      deletedAt: null,
      createdBy: actorUserId,
      updatedBy: null,
      deletedBy: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    };

    const karnatakaRajyotsavaHolidayId = new Types.ObjectId();
    const karnatakaRajyotsavaHoliday: HolidayLean = {
      _id: karnatakaRajyotsavaHolidayId,
      name: 'Karnataka Rajyotsava',
      date: '2026-11-02',
      year: 2026,
      type: HolidayType.REGIONAL,
      branchId: bangaloreBranchId, // Branch-specific for Bangalore
      description: 'Karnataka State Formation Day',
      isActive: true,
      deletedAt: null,
      createdBy: actorUserId,
      updatedBy: null,
      deletedBy: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    };

    const optionalFestivalHolidayId = new Types.ObjectId();
    const optionalFestivalHoliday: HolidayLean = {
      _id: optionalFestivalHolidayId,
      name: 'Optional Cultural Observance',
      date: '2026-10-05',
      year: 2026,
      type: HolidayType.OPTIONAL,
      branchId: null,
      description: 'Optional Floating Holiday',
      isActive: true,
      deletedAt: null,
      createdBy: actorUserId,
      updatedBy: null,
      deletedBy: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    };

    const allHolidaysStore = [
      gandhiJayantiHoliday,
      karnatakaRajyotsavaHoliday,
      optionalFestivalHoliday,
    ];

    let compOffRepo: jest.Mocked<CompOffRepository>;
    let compOffService: CompOffService;
    let scenarioAttendanceService: AttendanceService;

    beforeEach(() => {
      // Mock holidayRepo to mimic production MongoDB queries in findApplicableHolidays & findByDateAndBranch
      holidayRepo.findApplicableHolidays.mockImplementation(
        (
          startDate: string,
          endDate: string,
          branchId?: Types.ObjectId | string | null,
        ) => {
          const bIdStr = branchId ? branchId.toString() : null;
          const matched = allHolidaysStore.filter((h) => {
            if (!h.isActive || h.deletedAt) return false;
            if (h.date < startDate || h.date > endDate) return false;
            if (h.branchId === null) return true; // Organization-wide
            return bIdStr !== null && h.branchId.toString() === bIdStr;
          });
          return Promise.resolve(matched);
        },
      );

      holidayRepo.findByDateAndBranch.mockImplementation(
        (date: string, branchId: Types.ObjectId | string | null) => {
          const bIdStr = branchId ? branchId.toString() : null;
          const match = allHolidaysStore.find((h) => {
            if (!h.isActive || h.deletedAt) return false;
            if (h.date !== date) return false;
            if (h.branchId === null) return true; // Applies organization-wide
            return bIdStr !== null && h.branchId.toString() === bIdStr;
          });
          return Promise.resolve(match || null);
        },
      );

      // Branch resolver
      branchRepo.findById.mockImplementation((id: Types.ObjectId | string) => {
        const idStr = id.toString();
        if (idStr === bangaloreBranchId.toString()) {
          return Promise.resolve(bangaloreBranch);
        }
        if (idStr === delhiBranchId.toString()) {
          return Promise.resolve(delhiBranch);
        }
        return Promise.resolve(mockBranch);
      });

      // Shift resolver
      shiftService.resolveShift.mockResolvedValue(mockShift);

      // CompOffRepo Mock
      compOffRepo = {
        findByEmployeeAndAttendanceDate: jest.fn().mockResolvedValue(null),
        create: jest.fn((data: Partial<CompOffRecordLean>) =>
          Promise.resolve({
            _id: new Types.ObjectId(),
            status: CompOffStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          } as CompOffRecordLean),
        ),
      } as unknown as jest.Mocked<CompOffRepository>;

      // Mock Leave repositories needed for CompOffService
      const mockLeaveTypeRepo = {
        findById: jest.fn(),
      };
      const mockLeaveBalanceRepo = {
        findByEmployeeTypeYear: jest.fn(),
      };
      const mockLeaveTransactionRepo = {
        create: jest.fn(),
      };

      // Instantiate CompOffService with production integration
      compOffService = new CompOffService(
        compOffRepo,
        mockLeaveTypeRepo as unknown as LeaveTypeRepository,
        mockLeaveBalanceRepo as unknown as LeaveBalanceRepository,
        mockLeaveTransactionRepo as unknown as LeaveTransactionRepository,
        employeeRepo,
        attendanceRepo,
        holidayRepo,
        auditLogsService,
        authorizationService,
        mockConnection as unknown as Connection,
      );

      // Construct AttendanceService with injected holidayRepository
      scenarioAttendanceService = new AttendanceService(
        attendanceRepo,
        regularizationRepo,
        employeeRepo,
        branchRepo,
        shiftService,
        auditLogsService,
        authorizationService,
        mockConnection as unknown as Connection,
        undefined, // weeklyOffService optional
        leaveRequestRepo,
        holidayRepo,
      );
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('TC-PH-01: Applicable public holiday is correctly identified for the employee branch (both org-wide and branch-specific)', async () => {
      // 1. Organization-wide Public Holiday (Gandhi Jayanti: 2026-10-02)
      // Must apply to Bangalore branch employee
      const blrOrgHolidays = await holidayRepo.findApplicableHolidays(
        '2026-10-02',
        '2026-10-02',
        bangaloreBranchId,
      );
      expect(blrOrgHolidays).toHaveLength(1);
      expect(blrOrgHolidays[0].name).toBe('Gandhi Jayanti');
      expect(blrOrgHolidays[0].type).toBe(HolidayType.PUBLIC);
      expect(blrOrgHolidays[0].branchId).toBeNull();

      // Must also apply to Delhi branch employee
      const delOrgHolidays = await holidayRepo.findApplicableHolidays(
        '2026-10-02',
        '2026-10-02',
        delhiBranchId,
      );
      expect(delOrgHolidays).toHaveLength(1);
      expect(delOrgHolidays[0].name).toBe('Gandhi Jayanti');

      // 2. Branch-specific Regional Holiday (Karnataka Rajyotsava: 2026-11-02)
      // Must apply to Bangalore branch employee
      const blrRegHolidays = await holidayRepo.findApplicableHolidays(
        '2026-11-02',
        '2026-11-02',
        bangaloreBranchId,
      );
      expect(blrRegHolidays).toHaveLength(1);
      expect(blrRegHolidays[0].name).toBe('Karnataka Rajyotsava');
      expect(blrRegHolidays[0].type).toBe(HolidayType.REGIONAL);
      expect(blrRegHolidays[0].branchId?.toString()).toBe(
        bangaloreBranchId.toString(),
      );
    });

    it('TC-PH-02: Check-in on a public holiday is permitted and creates CHECKED_IN status (verifies production policy gap)', async () => {
      // Policy Gap Audit:
      // Production AttendanceService.checkIn() does not validate against HolidayRepository.
      // Employees are allowed to punch in freely on public holidays without 409 or 400 rejection.
      jest.useFakeTimers();
      try {
        const holidayDate = '2026-10-02'; // Gandhi Jayanti
        const checkInTimeUtc = new Date(`${holidayDate}T04:00:00.000Z`); // 09:30 IST
        jest.setSystemTime(checkInTimeUtc);

        employeeRepo.findByUserId.mockResolvedValue(mockBlrEmployee);
        branchRepo.findById.mockResolvedValue(bangaloreBranch);
        shiftService.resolveShift.mockResolvedValue(mockShift);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        const createdDoc: AttendanceLean = {
          _id: new Types.ObjectId(),
          employeeId: blrEmployeeId,
          attendanceDate: holidayDate,
          date: new Date(`${holidayDate}T00:00:00.000Z`),
          shiftId,
          shiftSnapshot: {
            name: mockShift.name,
            code: mockShift.code,
            startTime: mockShift.startTime,
            endTime: mockShift.endTime,
            isOvernight: mockShift.isOvernight,
            gracePeriodMinutes: mockShift.gracePeriodMinutes,
            minWorkMinutesForFullDay: mockShift.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay: mockShift.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes: mockShift.overtimeThresholdMinutes,
          },
          status: AttendanceStatus.CHECKED_IN,
          workMode: WorkMode.OFFICE,
          checkInTime: checkInTimeUtc,
          checkOutTime: null,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
          isLate: false,
          lateMinutes: 0,
          isEarlyDeparture: false,
          earlyDepartureMinutes: 0,
          overtimeMinutes: 0,
          checkInSource: AttendanceSource.WEB,
          checkInIp: '127.0.0.1',
          regularizationId: null,
          deletedAt: null,
          deletedBy: null,
          createdAt: checkInTimeUtc,
          updatedAt: checkInTimeUtc,
        };

        attendanceRepo.create.mockResolvedValue(createdDoc);

        const checkInResult = await scenarioAttendanceService.checkIn(
          blrEmployeeUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        // Check-in succeeds with CHECKED_IN because checkIn() lacks a holiday restriction
        expect(checkInResult).toBeDefined();
        expect(checkInResult.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(checkInResult.attendanceDate).toBe(holidayDate);
        expect(attendanceRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: blrEmployeeId,
            attendanceDate: holidayDate,
            status: AttendanceStatus.CHECKED_IN,
            checkInTime: checkInTimeUtc,
          }),
          expect.anything(),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-PH-03: Checkout records actual worked duration and status PRESENT, and employee qualifies for Comp-Off on public holiday', async () => {
      jest.useFakeTimers();
      try {
        const holidayDate = '2026-10-02';
        const checkInTimeUtc = new Date(`${holidayDate}T03:30:00.000Z`); // 09:00 IST
        const checkOutTimeUtc = new Date(`${holidayDate}T12:00:00.000Z`); // 17:30 IST (8.5 hrs = 510 min)
        jest.setSystemTime(checkOutTimeUtc);

        employeeRepo.findByUserId.mockResolvedValue(mockBlrEmployee);
        branchRepo.findById.mockResolvedValue(bangaloreBranch);

        const activeSession: AttendanceLean = {
          _id: new Types.ObjectId(),
          employeeId: blrEmployeeId,
          attendanceDate: holidayDate,
          date: new Date(`${holidayDate}T00:00:00.000Z`),
          shiftId,
          shiftSnapshot: {
            name: mockShift.name,
            code: mockShift.code,
            startTime: mockShift.startTime,
            endTime: mockShift.endTime,
            isOvernight: mockShift.isOvernight,
            gracePeriodMinutes: mockShift.gracePeriodMinutes,
            minWorkMinutesForFullDay: mockShift.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay: mockShift.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes: mockShift.overtimeThresholdMinutes,
          },
          status: AttendanceStatus.CHECKED_IN,
          workMode: WorkMode.OFFICE,
          checkInTime: checkInTimeUtc,
          checkOutTime: null,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
          isLate: false,
          lateMinutes: 0,
          isEarlyDeparture: false,
          earlyDepartureMinutes: 0,
          overtimeMinutes: 0,
          checkInSource: AttendanceSource.WEB,
          checkInIp: '127.0.0.1',
          regularizationId: null,
          deletedAt: null,
          deletedBy: null,
          createdAt: checkInTimeUtc,
          updatedAt: checkInTimeUtc,
        };

        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          activeSession,
        );
        attendanceRepo.checkOutSession.mockImplementation((_id, data) =>
          Promise.resolve({
            ...activeSession,
            ...data,
            checkOutTime: checkOutTimeUtc,
            status: data.status as AttendanceStatus,
          } as AttendanceLean),
        );

        const checkOutResult = await scenarioAttendanceService.checkOut(
          blrEmployeeUserId,
          {},
          clientMetadata,
        );

        // 1. Verify checkout calculates work duration as 510 minutes
        expect(checkOutResult.totalWorkMinutes).toBe(510);
        // 2. Production classification: status is PRESENT (does not auto-classify as HOLIDAY)
        expect(checkOutResult.status).toBe(AttendanceStatus.PRESENT);
        expect(attendanceRepo.checkOutSession).toHaveBeenCalledWith(
          activeSession._id,
          expect.objectContaining({
            checkOutTime: checkOutTimeUtc,
            totalWorkMinutes: 510,
            status: AttendanceStatus.PRESENT,
          }),
          expect.anything(),
        );

        // 3. Verify CompOffService integration:
        // Employee claims comp-off for working 510 minutes on Gandhi Jayanti
        const completedAttendance: AttendanceLean = {
          ...activeSession,
          checkOutTime: checkOutTimeUtc,
          totalWorkMinutes: 510,
          status: AttendanceStatus.PRESENT,
        };
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(
          completedAttendance,
        );

        const compOffClaim = await compOffService.claimCompOff(
          blrEmployeeUserId,
          {
            attendanceDate: holidayDate,
            reason: 'Production deployment on Gandhi Jayanti',
          },
          clientMetadata,
        );

        expect(compOffClaim).toBeDefined();
        expect(compOffClaim.status).toBe(CompOffStatus.PENDING);
        expect(compOffClaim.earnedDays).toBe(1); // 510 mins >= 240 mins -> full day (1.0) comp-off
        expect(compOffClaim.attendanceDate).toBe(holidayDate);
        expect(compOffRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: blrEmployeeId,
            attendanceDate: holidayDate,
            earnedDays: 1,
            status: CompOffStatus.PENDING,
          }),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-PH-04: Regularization on a mandatory holiday is blocked by Guard 5, but optional holiday is permitted', async () => {
      jest.useFakeTimers();
      try {
        // Today is 2026-10-06 (within 7-day SLA window from 2026-10-02)
        jest.setSystemTime(new Date('2026-10-06T03:30:00.000Z'));

        employeeRepo.findByUserId.mockResolvedValue(mockBlrEmployee);
        branchRepo.findById.mockResolvedValue(bangaloreBranch);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

        // 1. Mandatory Public Holiday (Gandhi Jayanti: 2026-10-02) -> MUST BE BLOCKED
        await expect(
          scenarioAttendanceService.createRegularization(
            blrEmployeeUserId,
            {
              attendanceDate: '2026-10-02',
              requestedCheckInTime: '2026-10-02T03:30:00.000Z',
              requestedCheckOutTime: '2026-10-02T12:30:00.000Z',
              reason: 'Missed punch on Gandhi Jayanti',
            },
            clientMetadata,
          ),
        ).rejects.toThrow(
          'Cannot regularize attendance on a company holiday (Gandhi Jayanti) (2026-10-02). Regularization is only permitted on scheduled working days. Please submit a Comp-Off or Overtime request instead.',
        );

        // 2. Optional Cultural Holiday (2026-10-05, type: OPTIONAL) -> NOT A MANDATORY HOLIDAY
        // Guard 5 filters for PUBLIC | COMPANY | REGIONAL, so OPTIONAL holiday passes Guard 5
        regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(null);
        const regDocId = new Types.ObjectId();
        regularizationRepo.create.mockImplementation((data) =>
          Promise.resolve({
            _id: regDocId,
            ...data,
            status: RegularizationStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as AttendanceRegularizationLean),
        );

        const optionalHolidayReg =
          await scenarioAttendanceService.createRegularization(
            blrEmployeeUserId,
            {
              attendanceDate: '2026-10-05',
              requestedCheckInTime: '2026-10-05T03:30:00.000Z',
              requestedCheckOutTime: '2026-10-05T12:30:00.000Z',
              reason: 'Regularizing work on optional holiday',
            },
            clientMetadata,
          );

        expect(optionalHolidayReg).toBeDefined();
        expect(optionalHolidayReg.attendanceDate).toBe('2026-10-05');
        expect(optionalHolidayReg.status).toBe(RegularizationStatus.PENDING);
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-PH-05: Branch-specific holiday applies only to designated branch and does not block other branches', async () => {
      // Karnataka Rajyotsava (2026-11-02) is configured exclusively for Bangalore branch
      jest.useFakeTimers();
      try {
        // Today is 2026-11-04 (within 7-day SLA window from 2026-11-02)
        jest.setSystemTime(new Date('2026-11-04T03:30:00.000Z'));

        // 1. Bangalore employee is BLOCKED on 2026-11-02
        employeeRepo.findByUserId.mockResolvedValue(mockBlrEmployee);
        branchRepo.findById.mockResolvedValue(bangaloreBranch);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

        await expect(
          scenarioAttendanceService.createRegularization(
            blrEmployeeUserId,
            {
              attendanceDate: '2026-11-02',
              requestedCheckInTime: '2026-11-02T03:30:00.000Z',
              requestedCheckOutTime: '2026-11-02T12:30:00.000Z',
              reason: 'Bangalore employee swipe miss',
            },
            clientMetadata,
          ),
        ).rejects.toThrow(
          'Cannot regularize attendance on a company holiday (Karnataka Rajyotsava) (2026-11-02). Regularization is only permitted on scheduled working days. Please submit a Comp-Off or Overtime request instead.',
        );

        // 2. Delhi employee is ALLOWED on 2026-11-02 (normal working day in Delhi)
        employeeRepo.findByUserId.mockResolvedValue(mockDelEmployee);
        branchRepo.findById.mockResolvedValue(delhiBranch);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(null);

        const delRegId = new Types.ObjectId();
        regularizationRepo.create.mockImplementation((data) =>
          Promise.resolve({
            _id: delRegId,
            ...data,
            status: RegularizationStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as AttendanceRegularizationLean),
        );

        const delRegResult =
          await scenarioAttendanceService.createRegularization(
            delEmployeeUserId,
            {
              attendanceDate: '2026-11-02',
              requestedCheckInTime: '2026-11-02T03:30:00.000Z',
              requestedCheckOutTime: '2026-11-02T12:30:00.000Z',
              reason:
                'Delhi employee swipe miss on normal working Sunday/Shift',
            },
            clientMetadata,
          );

        expect(delRegResult).toBeDefined();
        expect(delRegResult.attendanceDate).toBe('2026-11-02');
        expect(delRegResult.status).toBe(RegularizationStatus.PENDING);
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-PH-06: Ordinary working day is not classified as a holiday for regularization or comp-off', async () => {
      // 2026-10-07 is Wednesday (no holiday configured)
      const holidays = await holidayRepo.findApplicableHolidays(
        '2026-10-07',
        '2026-10-07',
        bangaloreBranchId,
      );
      expect(holidays).toHaveLength(0);

      jest.useFakeTimers();
      try {
        // Today is 2026-10-08 (1 day past 2026-10-07)
        jest.setSystemTime(new Date('2026-10-08T03:30:00.000Z'));

        employeeRepo.findByUserId.mockResolvedValue(mockBlrEmployee);
        branchRepo.findById.mockResolvedValue(bangaloreBranch);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        regularizationRepo.findPendingByEmployeeAndDate.mockResolvedValue(null);

        const regId = new Types.ObjectId();
        regularizationRepo.create.mockImplementation((data) =>
          Promise.resolve({
            _id: regId,
            ...data,
            status: RegularizationStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as AttendanceRegularizationLean),
        );

        // 1. Regularization succeeds on ordinary working day
        const regResult = await scenarioAttendanceService.createRegularization(
          blrEmployeeUserId,
          {
            attendanceDate: '2026-10-07',
            requestedCheckInTime: '2026-10-07T03:30:00.000Z',
            requestedCheckOutTime: '2026-10-07T12:30:00.000Z',
            reason: 'Card reader glitch on Wednesday',
          },
          clientMetadata,
        );
        expect(regResult).toBeDefined();
        expect(regResult.status).toBe(RegularizationStatus.PENDING);

        // 2. Comp-Off claim on ordinary working day (without overtime) MUST FAIL
        const normalWorkAttendance: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId: blrEmployeeId,
          attendanceDate: '2026-10-07',
          status: AttendanceStatus.PRESENT,
          totalWorkMinutes: 480,
          overtimeMinutes: 0,
        };
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(
          normalWorkAttendance,
        );

        await expect(
          compOffService.claimCompOff(
            blrEmployeeUserId,
            {
              attendanceDate: '2026-10-07',
              reason: 'Trying to claim comp-off for standard working Wednesday',
            },
            clientMetadata,
          ),
        ).rejects.toThrow(
          'Date 2026-10-07 does not qualify for compensatory off (no overtime logged and not a weekend/holiday)',
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-PH-07: Approved leave spanning a holiday excludes the holiday from ON_LEAVE sync and preserves holiday boundary', async () => {
      // Scenario: Employee has an approved leave from 2026-10-01 to 2026-10-03 (3 calendar days).
      // 2026-10-02 is Gandhi Jayanti (Public Holiday).
      // Under production leave calculation rules (deductHolidays: false), 2026-10-02 is added to excludedDates.
      // Consequently, syncLeaveAttendance never marks 2026-10-02 as ON_LEAVE.
      const leaveReqId = new Types.ObjectId();
      const approvedLeaveSpanningHoliday: LeaveRequestLean = {
        _id: leaveReqId,
        employeeId: blrEmployeeId,
        leaveTypeId: new Types.ObjectId(),
        startDate: '2026-10-01',
        endDate: '2026-10-03',
        totalDays: 2, // 3 calendar days minus 1 excluded holiday = 2 deductible days
        excludedDates: ['2026-10-02'], // Gandhi Jayanti excluded
        isHalfDay: false,
        status: LeaveRequestStatus.APPROVED,
        reason: 'Long weekend vacation',
        approvalTimeline: [],
      } as unknown as LeaveRequestLean;

      leaveRequestRepo.findById.mockResolvedValue(approvedLeaveSpanningHoliday);
      leaveRequestRepo.findOverlappingRequests.mockResolvedValue([
        approvedLeaveSpanningHoliday,
      ]);

      jest.useFakeTimers();
      try {
        const holidayDate = '2026-10-02';
        jest.setSystemTime(new Date(`${holidayDate}T03:30:00.000Z`));

        employeeRepo.findByUserId.mockResolvedValue(mockBlrEmployee);
        branchRepo.findById.mockResolvedValue(bangaloreBranch);

        // 1. Verify that on the holiday date, attendance record is NOT ON_LEAVE (it is unrecorded/null)
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

        // 2. Regularization on the holiday date is rejected as a "company holiday", NOT as "approved leave"
        await expect(
          scenarioAttendanceService.createRegularization(
            blrEmployeeUserId,
            {
              attendanceDate: holidayDate,
              requestedCheckInTime: `${holidayDate}T03:30:00.000Z`,
              requestedCheckOutTime: `${holidayDate}T12:30:00.000Z`,
              reason: 'Punch correction attempt on holiday during leave period',
            },
            clientMetadata,
          ),
        ).rejects.toThrow(
          'Cannot regularize attendance on a company holiday (Gandhi Jayanti) (2026-10-02). Regularization is only permitted on scheduled working days. Please submit a Comp-Off or Overtime request instead.',
        );

        // 3. Check-in attempt on the holiday date is not blocked by ON_LEAVE collision guard
        // (because the holiday was excluded from ON_LEAVE synchronization)
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
        attendanceRepo.create.mockImplementation((data) =>
          Promise.resolve({
            _id: new Types.ObjectId(),
            status: AttendanceStatus.CHECKED_IN,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          } as AttendanceLean),
        );

        const punchResult = await scenarioAttendanceService.checkIn(
          blrEmployeeUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );
        expect(punchResult).toBeDefined();
        expect(punchResult.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(punchResult.attendanceDate).toBe(holidayDate);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('Attendance Scenario 8: Employment Status Eligibility', () => {
    const testDate = '2026-10-15';
    const checkInTimeUtc = new Date(`${testDate}T03:30:00.000Z`); // 09:00 IST
    const kolkataBranch: Branch = {
      ...mockBranch,
      timezone: 'Asia/Kolkata',
    };

    beforeEach(() => {
      branchRepo.findById.mockResolvedValue(kolkataBranch);
      shiftService.resolveShift.mockResolvedValue(mockShift);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('TC-EE-01: ACTIVE status — check-in is allowed, creates record and preserves employee and shift snapshots', async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(checkInTimeUtc);

        const activeEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.ACTIVE,
        };
        employeeRepo.findByUserId.mockResolvedValue(activeEmployee);

        const createdDoc: AttendanceLean = {
          _id: new Types.ObjectId(),
          employeeId: activeEmployee._id,
          attendanceDate: testDate,
          date: new Date(`${testDate}T00:00:00.000Z`),
          shiftId: mockShift._id,
          shiftSnapshot: {
            name: mockShift.name,
            code: mockShift.code,
            startTime: mockShift.startTime,
            endTime: mockShift.endTime,
            isOvernight: mockShift.isOvernight,
            gracePeriodMinutes: mockShift.gracePeriodMinutes,
            minWorkMinutesForFullDay: mockShift.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay: mockShift.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes: mockShift.overtimeThresholdMinutes,
          },
          status: AttendanceStatus.CHECKED_IN,
          workMode: WorkMode.OFFICE,
          checkInTime: checkInTimeUtc,
          checkOutTime: null,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
          isLate: false,
          lateMinutes: 0,
          isEarlyDeparture: false,
          earlyDepartureMinutes: 0,
          overtimeMinutes: 0,
          checkInSource: AttendanceSource.WEB,
          checkInIp: '127.0.0.1',
          regularizationId: null,
          deletedAt: null,
          deletedBy: null,
          createdAt: checkInTimeUtc,
          updatedAt: checkInTimeUtc,
        };
        attendanceRepo.create.mockResolvedValue(createdDoc);

        const response = await service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        expect(response).toBeDefined();
        expect(response.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(response.attendanceDate).toBe(testDate);
        expect(attendanceRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: activeEmployee._id,
            shiftId: mockShift._id,
            attendanceDate: testDate,
            status: AttendanceStatus.CHECKED_IN,
            checkInTime: checkInTimeUtc,
          }),
          expect.anything(),
        );

        const createCall = attendanceRepo.create.mock.calls[0][0];
        expect(createCall.shiftSnapshot?.name).toBe(mockShift.name);
        expect(createCall.shiftSnapshot?.code).toBe(mockShift.code);
        expect(createCall.shiftSnapshot?.startTime).toBe(mockShift.startTime);
        expect(createCall.shiftSnapshot?.endTime).toBe(mockShift.endTime);
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-EE-02: PROBATION status — check-in is allowed, creates record and preserves employee and shift snapshots', async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(checkInTimeUtc);

        const probationEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.PROBATION,
        };
        employeeRepo.findByUserId.mockResolvedValue(probationEmployee);

        const createdDoc: AttendanceLean = {
          _id: new Types.ObjectId(),
          employeeId: probationEmployee._id,
          attendanceDate: testDate,
          date: new Date(`${testDate}T00:00:00.000Z`),
          shiftId: mockShift._id,
          shiftSnapshot: {
            name: mockShift.name,
            code: mockShift.code,
            startTime: mockShift.startTime,
            endTime: mockShift.endTime,
            isOvernight: mockShift.isOvernight,
            gracePeriodMinutes: mockShift.gracePeriodMinutes,
            minWorkMinutesForFullDay: mockShift.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay: mockShift.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes: mockShift.overtimeThresholdMinutes,
          },
          status: AttendanceStatus.CHECKED_IN,
          workMode: WorkMode.OFFICE,
          checkInTime: checkInTimeUtc,
          checkOutTime: null,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
          isLate: false,
          lateMinutes: 0,
          isEarlyDeparture: false,
          earlyDepartureMinutes: 0,
          overtimeMinutes: 0,
          checkInSource: AttendanceSource.WEB,
          checkInIp: '127.0.0.1',
          regularizationId: null,
          deletedAt: null,
          deletedBy: null,
          createdAt: checkInTimeUtc,
          updatedAt: checkInTimeUtc,
        };
        attendanceRepo.create.mockResolvedValue(createdDoc);

        const response = await service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        expect(response).toBeDefined();
        expect(response.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(attendanceRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: probationEmployee._id,
            shiftId: mockShift._id,
            status: AttendanceStatus.CHECKED_IN,
            checkInTime: checkInTimeUtc,
          }),
          expect.anything(),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-EE-03: NOTICE_PERIOD status — check-in is allowed before lastWorkingDate, creates record and preserves references', async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(checkInTimeUtc);

        const noticeEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.NOTICE_PERIOD,
          lastWorkingDate: new Date('2026-10-31T23:59:59.999Z'), // Notice period active through Oct 31
        } as unknown as EmployeeLean;
        employeeRepo.findByUserId.mockResolvedValue(noticeEmployee);

        const createdDoc: AttendanceLean = {
          _id: new Types.ObjectId(),
          employeeId: noticeEmployee._id,
          attendanceDate: testDate,
          date: new Date(`${testDate}T00:00:00.000Z`),
          shiftId: mockShift._id,
          shiftSnapshot: {
            name: mockShift.name,
            code: mockShift.code,
            startTime: mockShift.startTime,
            endTime: mockShift.endTime,
            isOvernight: mockShift.isOvernight,
            gracePeriodMinutes: mockShift.gracePeriodMinutes,
            minWorkMinutesForFullDay: mockShift.minWorkMinutesForFullDay,
            minWorkMinutesForHalfDay: mockShift.minWorkMinutesForHalfDay,
            overtimeThresholdMinutes: mockShift.overtimeThresholdMinutes,
          },
          status: AttendanceStatus.CHECKED_IN,
          workMode: WorkMode.OFFICE,
          checkInTime: checkInTimeUtc,
          checkOutTime: null,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
          isLate: false,
          lateMinutes: 0,
          isEarlyDeparture: false,
          earlyDepartureMinutes: 0,
          overtimeMinutes: 0,
          checkInSource: AttendanceSource.WEB,
          checkInIp: '127.0.0.1',
          regularizationId: null,
          deletedAt: null,
          deletedBy: null,
          createdAt: checkInTimeUtc,
          updatedAt: checkInTimeUtc,
        };
        attendanceRepo.create.mockResolvedValue(createdDoc);

        const response = await service.checkIn(
          actorUserId,
          { workMode: WorkMode.OFFICE },
          clientMetadata,
        );

        expect(response).toBeDefined();
        expect(response.status).toBe(AttendanceStatus.CHECKED_IN);
        expect(attendanceRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: noticeEmployee._id,
            shiftId: mockShift._id,
            status: AttendanceStatus.CHECKED_IN,
          }),
          expect.anything(),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-EE-04: RESIGNED status — check-in rejected with 403 FORBIDDEN, no attendance record created or session modified', async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(checkInTimeUtc);

        const resignedEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.RESIGNED,
        };
        employeeRepo.findByUserId.mockResolvedValue(resignedEmployee);

        await expect(
          service.checkIn(
            actorUserId,
            { workMode: WorkMode.OFFICE },
            clientMetadata,
          ),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.FORBIDDEN,
            'Employee is not eligible to record attendance',
            HttpStatus.FORBIDDEN,
          ),
        );

        // Verification: No attendance record is created
        expect(attendanceRepo.create).not.toHaveBeenCalled();
        expect(
          attendanceRepo.updateCheckInForExistingLeave,
        ).not.toHaveBeenCalled();
        expect(attendanceRepo.updateById).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-EE-05: TERMINATED status — check-in rejected with 403 FORBIDDEN, no attendance record created or session modified', async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(checkInTimeUtc);

        const terminatedEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.TERMINATED,
        };
        employeeRepo.findByUserId.mockResolvedValue(terminatedEmployee);

        await expect(
          service.checkIn(
            actorUserId,
            { workMode: WorkMode.OFFICE },
            clientMetadata,
          ),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.FORBIDDEN,
            'Employee is not eligible to record attendance',
            HttpStatus.FORBIDDEN,
          ),
        );

        // Verification: No attendance record is created
        expect(attendanceRepo.create).not.toHaveBeenCalled();
        expect(
          attendanceRepo.updateCheckInForExistingLeave,
        ).not.toHaveBeenCalled();
        expect(attendanceRepo.updateById).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-EE-06: Cross-Operation Audit: Manual attendance creation rejects TERMINATED and RESIGNED employees with 403 FORBIDDEN', async () => {
      const adminUserId = new Types.ObjectId();
      authorizationService.hasPermission.mockResolvedValue(true);

      // 1. Terminated employee target
      const terminatedTarget: EmployeeLean = {
        ...mockEmployee,
        employmentStatus: EmploymentStatus.TERMINATED,
      };
      employeeRepo.findById.mockResolvedValue(terminatedTarget);

      await expect(
        service.recordManualAttendance(
          adminUserId,
          {
            employeeId: terminatedTarget._id.toString(),
            attendanceDate: testDate,
            checkInTime: `${testDate}T03:30:00.000Z`,
            checkOutTime: `${testDate}T12:30:00.000Z`,
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Employee is not eligible to record attendance',
          HttpStatus.FORBIDDEN,
        ),
      );
      expect(attendanceRepo.create).not.toHaveBeenCalled();

      // 2. Resigned employee target
      const resignedTarget: EmployeeLean = {
        ...mockEmployee,
        employmentStatus: EmploymentStatus.RESIGNED,
      };
      employeeRepo.findById.mockResolvedValue(resignedTarget);

      await expect(
        service.recordManualAttendance(
          adminUserId,
          {
            employeeId: resignedTarget._id.toString(),
            attendanceDate: testDate,
            checkInTime: `${testDate}T03:30:00.000Z`,
            checkOutTime: `${testDate}T12:30:00.000Z`,
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Employee is not eligible to record attendance',
          HttpStatus.FORBIDDEN,
        ),
      );
      expect(attendanceRepo.create).not.toHaveBeenCalled();
    });

    it('TC-EE-07: Cross-Operation Audit: Attendance regularization rejects TERMINATED and RESIGNED employees with 403 FORBIDDEN', async () => {
      // 1. Terminated employee
      const terminatedEmp: EmployeeLean = {
        ...mockEmployee,
        employmentStatus: EmploymentStatus.TERMINATED,
      };
      employeeRepo.findByUserId.mockResolvedValue(terminatedEmp);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: testDate,
            requestedCheckInTime: `${testDate}T03:30:00.000Z`,
            requestedCheckOutTime: `${testDate}T12:30:00.000Z`,
            reason: 'Regularizing past punch while terminated',
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Employee is not eligible to record attendance',
          HttpStatus.FORBIDDEN,
        ),
      );
      expect(regularizationRepo.create).not.toHaveBeenCalled();

      // 2. Resigned employee
      const resignedEmp: EmployeeLean = {
        ...mockEmployee,
        employmentStatus: EmploymentStatus.RESIGNED,
      };
      employeeRepo.findByUserId.mockResolvedValue(resignedEmp);

      await expect(
        service.createRegularization(
          actorUserId,
          {
            attendanceDate: testDate,
            requestedCheckInTime: `${testDate}T03:30:00.000Z`,
            requestedCheckOutTime: `${testDate}T12:30:00.000Z`,
            reason: 'Regularizing past punch while resigned',
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Employee is not eligible to record attendance',
          HttpStatus.FORBIDDEN,
        ),
      );
      expect(regularizationRepo.create).not.toHaveBeenCalled();
    });

    it('TC-EE-08: Cross-Operation Audit: Check-out after status change (TERMINATED) is allowed to close an active session, while checkout with no active session is rejected', async () => {
      jest.useFakeTimers();
      try {
        const checkOutTimeUtc = new Date(`${testDate}T12:30:00.000Z`); // 18:00 IST
        jest.setSystemTime(checkOutTimeUtc);

        // Employee was active in the morning and has an active CHECKED_IN session in DB
        const activeSession: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId: mockEmployee._id,
          attendanceDate: testDate,
          checkInTime: checkInTimeUtc,
          checkOutTime: null,
          status: AttendanceStatus.CHECKED_IN,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
        };
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(activeSession);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          activeSession,
        );
        shiftService.resolveShift.mockResolvedValue(mockShift);
        attendanceRepo.checkOutSession.mockImplementation((id, update) =>
          Promise.resolve({
            ...activeSession,
            ...update,
          } as unknown as AttendanceLean),
        );

        // Status is changed midday to TERMINATED by HR/Admin
        const terminatedEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.TERMINATED,
          terminationDate: new Date(`${testDate}T23:59:59.999Z`),
        } as unknown as EmployeeLean;
        employeeRepo.findByUserId.mockResolvedValue(terminatedEmployee);

        // Employee attempts to check out at end of day: succeeds to close active session
        const checkoutResult = await service.checkOut(
          actorUserId,
          {},
          clientMetadata,
        );
        expect(checkoutResult.status).toBe(AttendanceStatus.PRESENT);
        expect(attendanceRepo.checkOutSession).toHaveBeenCalled();

        // But an inactive employee with NO active session is rejected
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        await expect(
          service.checkOut(actorUserId, {}, clientMetadata),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.FORBIDDEN,
            'Employee is not eligible to record attendance',
            HttpStatus.FORBIDDEN,
          ),
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });
  describe('Attendance Milestone 1: Employee Lifecycle Completion', () => {
    const adminUserId = new Types.ObjectId();
    const m1TestDate = '2026-11-04';
    const m1CheckInUtc = new Date('2026-11-04T03:30:00.000Z'); // 09:00 IST
    const m1CheckOutUtc = new Date('2026-11-04T12:30:00.000Z'); // 18:00 IST

    beforeEach(() => {
      shiftService.resolveShift.mockResolvedValue(mockShift);
      branchRepo.findById.mockResolvedValue(mockBranch);
      authorizationService.hasPermission.mockResolvedValue(true);
    });

    it('TC-M1-01: Termination after check-in allows employee to complete checkout and calculates hours', async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(m1CheckOutUtc);

        const activeSession: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId: mockEmployee._id,
          attendanceDate: m1TestDate,
          checkInTime: m1CheckInUtc,
          checkOutTime: null,
          status: AttendanceStatus.CHECKED_IN,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
        };
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(activeSession);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          activeSession,
        );
        attendanceRepo.checkOutSession.mockImplementation((id, update) =>
          Promise.resolve({
            ...activeSession,
            ...update,
          } as unknown as AttendanceLean),
        );

        // Employee was terminated midday
        const terminatedEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.TERMINATED,
          terminationDate: new Date('2026-11-04T10:00:00.000Z'),
        } as unknown as EmployeeLean;
        employeeRepo.findByUserId.mockResolvedValue(terminatedEmployee);

        const res = await service.checkOut(actorUserId, {}, clientMetadata);
        expect(res.status).toBe(AttendanceStatus.PRESENT);
        expect(res.totalWorkMinutes).toBe(540);
        expect(attendanceRepo.checkOutSession).toHaveBeenCalled();
        expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AuditAction.ATTENDANCE_CHECK_OUT,
          }),
          expect.anything(),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-M1-02: Resignation after check-in allows employee to complete checkout and calculates hours', async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(m1CheckOutUtc);

        const activeSession: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId: mockEmployee._id,
          attendanceDate: m1TestDate,
          checkInTime: m1CheckInUtc,
          checkOutTime: null,
          status: AttendanceStatus.CHECKED_IN,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
        };
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(activeSession);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          activeSession,
        );
        attendanceRepo.checkOutSession.mockImplementation((id, update) =>
          Promise.resolve({
            ...activeSession,
            ...update,
          } as unknown as AttendanceLean),
        );

        // Employee resigned midday with lastWorkingDate today
        const resignedEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.RESIGNED,
          lastWorkingDate: new Date('2026-11-04T23:59:59.999Z'),
        } as unknown as EmployeeLean;
        employeeRepo.findByUserId.mockResolvedValue(resignedEmployee);

        const res = await service.checkOut(actorUserId, {}, clientMetadata);
        expect(res.status).toBe(AttendanceStatus.PRESENT);
        expect(res.totalWorkMinutes).toBe(540);
        expect(attendanceRepo.checkOutSession).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-M1-03: Inactive employee attempting a new check-in remains rejected (TERMINATED and RESIGNED)', async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(m1CheckInUtc);

        // 1. Terminated employee
        employeeRepo.findByUserId.mockResolvedValue({
          ...mockEmployee,
          employmentStatus: EmploymentStatus.TERMINATED,
        });

        await expect(
          service.checkIn(actorUserId, {}, clientMetadata),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.FORBIDDEN,
            'Employee is not eligible to record attendance',
            HttpStatus.FORBIDDEN,
          ),
        );
        expect(attendanceRepo.create).not.toHaveBeenCalled();

        // 2. Resigned employee
        employeeRepo.findByUserId.mockResolvedValue({
          ...mockEmployee,
          employmentStatus: EmploymentStatus.RESIGNED,
        });

        await expect(
          service.checkIn(actorUserId, {}, clientMetadata),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.FORBIDDEN,
            'Employee is not eligible to record attendance',
            HttpStatus.FORBIDDEN,
          ),
        );
        expect(attendanceRepo.create).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-M1-04: Historical manual attendance within legitimate employment tenure succeeds for terminated employee', async () => {
      const historicalDate = '2026-10-15';
      const targetEmployeeId = new Types.ObjectId();
      const terminatedEmployee: EmployeeLean = {
        ...mockEmployee,
        _id: targetEmployeeId,
        dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
        employmentStatus: EmploymentStatus.TERMINATED,
        terminationDate: new Date('2026-10-31T23:59:59.999Z'),
      } as unknown as EmployeeLean;
      employeeRepo.findById.mockResolvedValue(terminatedEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      attendanceRepo.create.mockImplementation((data) =>
        Promise.resolve({
          ...data,
          _id: new Types.ObjectId(),
        } as unknown as AttendanceLean),
      );

      const res = await service.recordManualAttendance(
        adminUserId,
        {
          employeeId: targetEmployeeId.toString(),
          attendanceDate: historicalDate,
          checkInTime: '09:00',
          checkOutTime: '18:00',
        },
        clientMetadata,
      );

      expect(res.status).toBe(AttendanceStatus.PRESENT);
      expect(res.totalWorkMinutes).toBe(540);
      expect(attendanceRepo.create).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      const auditCall = auditLogsService.createAuditLog.mock.calls[0][0];
      expect(auditCall.action).toBe(AuditAction.ATTENDANCE_CHECK_IN);
      expect(
        (auditCall.details as Record<string, unknown>)?.isManualEntry,
      ).toBe(true);
    });

    it('TC-M1-05: Historical manual attendance after effective end date is rejected with 403 FORBIDDEN', async () => {
      const postTerminationDate = '2026-11-05';
      const targetEmployeeId = new Types.ObjectId();
      const terminatedEmployee: EmployeeLean = {
        ...mockEmployee,
        _id: targetEmployeeId,
        dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
        employmentStatus: EmploymentStatus.TERMINATED,
        terminationDate: new Date('2026-10-31T23:59:59.999Z'),
      } as unknown as EmployeeLean;
      employeeRepo.findById.mockResolvedValue(terminatedEmployee);

      await expect(
        service.recordManualAttendance(
          adminUserId,
          {
            employeeId: targetEmployeeId.toString(),
            attendanceDate: postTerminationDate,
            checkInTime: '09:00',
            checkOutTime: '18:00',
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Employee is not eligible to record attendance after effective end date',
          HttpStatus.FORBIDDEN,
        ),
      );
      expect(attendanceRepo.create).not.toHaveBeenCalled();
    });

    it('TC-M1-06: Historical manual attendance before date of joining is rejected with 403 FORBIDDEN', async () => {
      const preJoiningDate = '2025-12-15';
      const targetEmployeeId = new Types.ObjectId();
      const terminatedEmployee: EmployeeLean = {
        ...mockEmployee,
        _id: targetEmployeeId,
        dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
        employmentStatus: EmploymentStatus.TERMINATED,
        terminationDate: new Date('2026-10-31T23:59:59.999Z'),
      } as unknown as EmployeeLean;
      employeeRepo.findById.mockResolvedValue(terminatedEmployee);

      await expect(
        service.recordManualAttendance(
          adminUserId,
          {
            employeeId: targetEmployeeId.toString(),
            attendanceDate: preJoiningDate,
            checkInTime: '09:00',
            checkOutTime: '18:00',
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Employee is not eligible to record attendance before joining date',
          HttpStatus.FORBIDDEN,
        ),
      );
      expect(attendanceRepo.create).not.toHaveBeenCalled();
    });

    it('TC-M1-07: Unauthorized users cannot record historical attendance (403 FORBIDDEN)', async () => {
      authorizationService.hasPermission.mockResolvedValue(false);

      await expect(
        service.recordManualAttendance(
          new Types.ObjectId(),
          {
            employeeId: new Types.ObjectId().toString(),
            attendanceDate: '2026-10-15',
            checkInTime: '09:00',
            checkOutTime: '18:00',
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Insufficient permissions to manually record employee attendance',
          HttpStatus.FORBIDDEN,
        ),
      );
      expect(attendanceRepo.create).not.toHaveBeenCalled();
    });

    it('TC-M1-08: Inactive employee checkout without active session is rejected with 403 FORBIDDEN', async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(m1CheckOutUtc);

        const terminatedEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.TERMINATED,
        };
        employeeRepo.findByUserId.mockResolvedValue(terminatedEmployee);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        await expect(
          service.checkOut(actorUserId, {}, clientMetadata),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.FORBIDDEN,
            'Employee is not eligible to record attendance',
            HttpStatus.FORBIDDEN,
          ),
        );
        expect(attendanceRepo.updateById).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-M1-09: Concurrent/Double checkout protection: Inactive employee cannot checkout again once session is completed', async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(m1CheckOutUtc);

        const completedSession: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId: mockEmployee._id,
          attendanceDate: m1TestDate,
          checkInTime: m1CheckInUtc,
          checkOutTime: m1CheckOutUtc,
          status: AttendanceStatus.PRESENT,
        };
        const terminatedEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.TERMINATED,
        };
        employeeRepo.findByUserId.mockResolvedValue(terminatedEmployee);
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(
          completedSession,
        );
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        await expect(
          service.checkOut(actorUserId, {}, clientMetadata),
        ).rejects.toThrow(
          new AppError(
            ErrorCode.FORBIDDEN,
            'Employee is not eligible to record attendance',
            HttpStatus.FORBIDDEN,
          ),
        );
        expect(attendanceRepo.updateById).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-M1-10: Duplicate attendance prevention: Historical manual entry for already recorded date rejects with 409 CONFLICT', async () => {
      const historicalDate = '2026-10-15';
      const targetEmployeeId = new Types.ObjectId();
      const terminatedEmployee: EmployeeLean = {
        ...mockEmployee,
        _id: targetEmployeeId,
        dateOfJoining: new Date('2026-01-01T00:00:00.000Z'),
        employmentStatus: EmploymentStatus.TERMINATED,
        terminationDate: new Date('2026-10-31T23:59:59.999Z'),
      } as unknown as EmployeeLean;
      employeeRepo.findById.mockResolvedValue(terminatedEmployee);

      const existingRecord: AttendanceLean = {
        ...mockAttendance,
        _id: new Types.ObjectId(),
        employeeId: targetEmployeeId,
        attendanceDate: historicalDate,
      };
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(existingRecord);

      await expect(
        service.recordManualAttendance(
          adminUserId,
          {
            employeeId: targetEmployeeId.toString(),
            attendanceDate: historicalDate,
            checkInTime: '09:00',
            checkOutTime: '18:00',
          },
          clientMetadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `Attendance record already exists for ${historicalDate}`,
          HttpStatus.CONFLICT,
        ),
      );
      expect(attendanceRepo.create).not.toHaveBeenCalled();
    });

    it('TC-M1-11: Multi-punch cooldown guard: Inactive employee checkout within cooldown window is rejected with 400 BAD_REQUEST', async () => {
      jest.useFakeTimers();
      try {
        // Immediate checkout 5 seconds after check-in
        const rapidCheckOutUtc = new Date(m1CheckInUtc.getTime() + 5000);
        jest.setSystemTime(rapidCheckOutUtc);

        const activeSession: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId: mockEmployee._id,
          attendanceDate: m1TestDate,
          checkInTime: m1CheckInUtc,
          checkOutTime: null,
          status: AttendanceStatus.CHECKED_IN,
        };
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(activeSession);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          activeSession,
        );

        const terminatedEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.TERMINATED,
          terminationDate: new Date('2026-11-04T23:59:59.999Z'),
        } as unknown as EmployeeLean;
        employeeRepo.findByUserId.mockResolvedValue(terminatedEmployee);

        await expect(
          service.checkOut(actorUserId, {}, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.VALIDATION_ERROR,
          statusCode: HttpStatus.BAD_REQUEST,
        });
        expect(attendanceRepo.updateById).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-M1-12: NOTICE_PERIOD employee checks in October 31 at 22:00 and checks out November 1 at 06:00 (overnight shift on LWD); checkout succeeds', async () => {
      jest.useFakeTimers();
      try {
        const checkInUtc = new Date('2026-10-31T16:30:00.000Z'); // 22:00 IST on Oct 31
        const checkOutUtc = new Date('2026-11-01T00:30:00.000Z'); // 06:00 IST on Nov 01
        jest.setSystemTime(checkOutUtc);

        const overnightShiftSnapshot = {
          name: 'Night Shift',
          code: 'NIGHT',
          startTime: '22:00',
          endTime: '06:00',
          isOvernight: true,
          gracePeriodMinutes: 15,
          minWorkMinutesForFullDay: 480,
          minWorkMinutesForHalfDay: 240,
          overtimeThresholdMinutes: 480,
        };

        const activeOvernightSession: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId: mockEmployee._id,
          attendanceDate: '2026-10-31',
          checkInTime: checkInUtc,
          checkOutTime: null,
          status: AttendanceStatus.CHECKED_IN,
          shiftSnapshot: overnightShiftSnapshot,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
        };

        // On Nov 01 (checkout date), findByEmployeeAndDate returns null
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        // Active session lookup returns the unclosed session from yesterday (Oct 31)
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          activeOvernightSession,
        );
        attendanceRepo.checkOutSession.mockImplementation((id, data) =>
          Promise.resolve({
            ...activeOvernightSession,
            ...data,
          } as unknown as AttendanceLean),
        );

        const noticePeriodEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.NOTICE_PERIOD,
          lastWorkingDate: new Date('2026-10-31T12:00:00.000Z'),
        } as unknown as EmployeeLean;
        employeeRepo.findByUserId.mockResolvedValue(noticePeriodEmployee);

        const result = await service.checkOut(actorUserId, {}, clientMetadata);

        expect(result.status).toBe(AttendanceStatus.PRESENT);
        expect(result.totalWorkMinutes).toBe(480);
        expect(attendanceRepo.checkOutSession).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-M1-13: ACTIVE employee checks in October 31 at 22:00 and checks out November 1 at 06:00 on their last working date; checkout succeeds', async () => {
      jest.useFakeTimers();
      try {
        const checkInUtc = new Date('2026-10-31T16:30:00.000Z'); // 22:00 IST on Oct 31
        const checkOutUtc = new Date('2026-11-01T00:30:00.000Z'); // 06:00 IST on Nov 01
        jest.setSystemTime(checkOutUtc);

        const overnightShiftSnapshot = {
          name: 'Night Shift',
          code: 'NIGHT',
          startTime: '22:00',
          endTime: '06:00',
          isOvernight: true,
          gracePeriodMinutes: 15,
          minWorkMinutesForFullDay: 480,
          minWorkMinutesForHalfDay: 240,
          overtimeThresholdMinutes: 480,
        };

        const activeOvernightSession: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId: mockEmployee._id,
          attendanceDate: '2026-10-31',
          checkInTime: checkInUtc,
          checkOutTime: null,
          status: AttendanceStatus.CHECKED_IN,
          shiftSnapshot: overnightShiftSnapshot,
          breaks: [],
          totalBreakMinutes: 0,
          totalWorkMinutes: 0,
        };

        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          activeOvernightSession,
        );
        attendanceRepo.checkOutSession.mockImplementation((id, data) =>
          Promise.resolve({
            ...activeOvernightSession,
            ...data,
          } as unknown as AttendanceLean),
        );

        const activeEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.ACTIVE,
          lastWorkingDate: new Date('2026-10-31T12:00:00.000Z'),
        } as unknown as EmployeeLean;
        employeeRepo.findByUserId.mockResolvedValue(activeEmployee);

        const result = await service.checkOut(actorUserId, {}, clientMetadata);

        expect(result.status).toBe(AttendanceStatus.PRESENT);
        expect(result.totalWorkMinutes).toBe(480);
        expect(attendanceRepo.checkOutSession).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-M1-14: Employee whose attendance date is after their effective end date; checkout remains rejected with 403 FORBIDDEN', async () => {
      jest.useFakeTimers();
      try {
        const checkOutUtc = new Date('2026-11-02T00:30:00.000Z');
        jest.setSystemTime(checkOutUtc);

        // Session attendanceDate is Nov 01, but employee lastWorkingDate was Oct 31
        const invalidSession: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId: mockEmployee._id,
          attendanceDate: '2026-11-01',
          checkInTime: new Date('2026-11-01T16:30:00.000Z'),
          checkOutTime: null,
          status: AttendanceStatus.CHECKED_IN,
        };

        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(invalidSession);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          invalidSession,
        );

        const activeEmployee: EmployeeLean = {
          ...mockEmployee,
          employmentStatus: EmploymentStatus.ACTIVE,
          lastWorkingDate: new Date('2026-10-31T12:00:00.000Z'),
        } as unknown as EmployeeLean;
        employeeRepo.findByUserId.mockResolvedValue(activeEmployee);

        await expect(
          service.checkOut(actorUserId, {}, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
          statusCode: HttpStatus.FORBIDDEN,
        });

        expect(attendanceRepo.checkOutSession).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('TC-M1-15: Concurrent checkout still permits only one successful closure via atomic checkOutSession', async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(m1CheckOutUtc);

        const activeSession: AttendanceLean = {
          ...mockAttendance,
          _id: new Types.ObjectId(),
          employeeId: mockEmployee._id,
          attendanceDate: m1TestDate,
          checkInTime: m1CheckInUtc,
          checkOutTime: null,
          status: AttendanceStatus.CHECKED_IN,
        };

        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(activeSession);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          activeSession,
        );
        employeeRepo.findByUserId.mockResolvedValue(mockEmployee);

        // 1. First checkout succeeds atomically
        attendanceRepo.checkOutSession.mockResolvedValueOnce({
          ...activeSession,
          status: AttendanceStatus.PRESENT,
          checkOutTime: m1CheckOutUtc,
        });

        const firstRes = await service.checkOut(
          actorUserId,
          {},
          clientMetadata,
        );
        expect(firstRes.status).toBe(AttendanceStatus.PRESENT);

        // 2. Second concurrent checkout finds 0 matching documents (status was already updated)
        attendanceRepo.checkOutSession.mockResolvedValueOnce(null);

        await expect(
          service.checkOut(actorUserId, {}, clientMetadata),
        ).rejects.toMatchObject({
          code: ErrorCode.RESOURCE_ALREADY_EXISTS,
          statusCode: HttpStatus.CONFLICT,
        });
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

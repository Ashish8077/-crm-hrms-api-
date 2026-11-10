/* eslint-disable @typescript-eslint/unbound-method */
import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
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

describe('AttendanceService', () => {
  let service: AttendanceService;
  let attendanceRepo: jest.Mocked<AttendanceRepository>;
  let regularizationRepo: jest.Mocked<AttendanceRegularizationRepository>;
  let employeeRepo: jest.Mocked<EmployeeRepository>;
  let branchRepo: jest.Mocked<BranchRepository>;
  let shiftService: jest.Mocked<ShiftService>;
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

  const mockBranch: Branch = {
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
  };

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
            checkOutSession: jest.fn(),
            startBreak: jest.fn(),
            endActiveBreak: jest.fn(),
            getMonthlySummary: jest.fn(),
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
});

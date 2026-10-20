/* eslint-disable @typescript-eslint/unbound-method */
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
  AttendanceType,
  BreakType,
  RegularizationStatus,
} from '../constants/attendance.constant';
import { ShiftLean } from '../repositories/shift.repository';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let attendanceRepo: jest.Mocked<AttendanceRepository>;
  let regularizationRepo: jest.Mocked<AttendanceRegularizationRepository>;
  let employeeRepo: jest.Mocked<EmployeeRepository>;
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
    dateOfJoining: new Date(),
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
    dateOfJoining: new Date(),
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
    checkInTime: new Date('2026-10-15T09:00:00.000Z'),
    checkOutTime: null,
    status: AttendanceStatus.CHECKED_IN,
    attendanceType: AttendanceType.REGULAR,
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
    requestedCheckInTime: new Date('2026-10-15T09:00:00.000Z'),
    requestedCheckOutTime: new Date('2026-10-15T18:00:00.000Z'),
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
            findCalendar: jest.fn(),
            findList: jest.fn(),
            updateById: jest.fn(),
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

    it('should throw RESOURCE_ALREADY_EXISTS if already checked in today', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(mockAttendance);

      await expect(
        service.checkIn(actorUserId, {}, clientMetadata),
      ).rejects.toThrow(AppError);

      try {
        await service.checkIn(actorUserId, {}, clientMetadata);
      } catch (e: unknown) {
        if (e instanceof AppError) {
          expect(e.code).toBe(ErrorCode.RESOURCE_ALREADY_EXISTS);
        }
      }
    });

    it('should successfully record check-in and create audit log', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
      shiftService.resolveShift.mockResolvedValue(mockShift);
      attendanceRepo.create.mockResolvedValue(mockAttendance);

      const result = await service.checkIn(
        actorUserId,
        { attendanceType: AttendanceType.REGULAR },
        clientMetadata,
      );

      expect(attendanceRepo.create).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      expect(result.status).toBe(AttendanceStatus.CHECKED_IN);
    });
  });

  describe('checkOut', () => {
    it('should throw VALIDATION_ERROR if no check-in exists for today', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

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

    it('should successfully check out and update status to PRESENT if full hours met', async () => {
      employeeRepo.findByUserId.mockResolvedValue(mockEmployee);
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue({
        ...mockAttendance,
        checkInTime: new Date(Date.now() - 9 * 60 * 60 * 1000), // 9 hours ago
      });

      attendanceRepo.updateById.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.PRESENT,
        totalWorkMinutes: 540,
        checkOutTime: new Date(),
      });

      const result = await service.checkOut(actorUserId, {}, clientMetadata);

      expect(attendanceRepo.updateById).toHaveBeenCalled();
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
      ).rejects.toThrow(AppError);

      try {
        await service.approveRegularization(
          regularizationId,
          actorUserId,
          {},
          clientMetadata,
        );
      } catch (e: unknown) {
        if (e instanceof AppError) {
          expect(e.code).toBe(ErrorCode.FORBIDDEN);
          expect(e.message).toContain('Self-approval');
        }
      }
    });

    it('should allow manager to approve regularization and recalculate attendance', async () => {
      regularizationRepo.findById.mockResolvedValue(mockRegularization);
      employeeRepo.findByUserId.mockResolvedValue(mockManagerEmployee);
      employeeRepo.findById.mockResolvedValue(mockEmployee);
      regularizationRepo.updateStatus.mockResolvedValue({
        ...mockRegularization,
        status: RegularizationStatus.APPROVED,
        reviewedBy: managerUserId,
        reviewedAt: new Date(),
      });
      attendanceRepo.findByEmployeeAndDate.mockResolvedValue(mockAttendance);
      shiftService.resolveShift.mockResolvedValue(mockShift);
      attendanceRepo.updateById.mockResolvedValue({
        ...mockAttendance,
        status: AttendanceStatus.REGULARIZED,
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
      expect(attendanceRepo.updateById).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
      expect(result.status).toBe(RegularizationStatus.APPROVED);
    });
  });
});

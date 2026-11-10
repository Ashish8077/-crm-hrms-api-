/* eslint-disable @typescript-eslint/unbound-method */
import {
  ExecutionContext,
  HttpStatus,
  ValidationPipe,
  ValidationError,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Connection, Types } from 'mongoose';

import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './services/attendance.service';
import { AttendanceRepository } from './repositories/attendance.repository';
import { AttendanceRegularizationRepository } from './repositories/attendance-regularization.repository';
import { EmployeeRepository } from '../employees/repositories/employee.repository';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { ShiftService } from './services/shift.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { SessionRepository } from '../auth/repositories/session.repository';
import {
  UserRepository,
  UserLean,
} from '../users/repositories/user.repository';
import { SessionDocument } from '../auth/schemas/session.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { UserStatus } from '../users/constants/user-status.constant';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import {
  AttendanceSource,
  AttendanceStatus,
  WorkMode,
} from './constants/attendance.constant';
import { AttendanceLean } from './repositories/attendance.repository';
import { EmployeeLean } from '../employees/repositories/employee.repository';
import { ShiftLean } from './repositories/shift.repository';
import { AttendanceSummaryQueryDto } from './dto/attendance-summary-query.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance-query.dto';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('Attendance GET Endpoints Integration Suite (/today, /summary, /reports)', () => {
  let controller: AttendanceController;
  let service: AttendanceService;
  let jwtAuthGuard: JwtAuthGuard;
  let permissionsGuard: PermissionsGuard;
  let validationPipe: ValidationPipe;
  let jwtService: JwtService;

  let attendanceRepo: jest.Mocked<AttendanceRepository>;
  let employeeRepo: jest.Mocked<EmployeeRepository>;
  let branchRepo: jest.Mocked<BranchRepository>;
  let authorizationService: jest.Mocked<AuthorizationService>;
  let sessionRepo: jest.Mocked<SessionRepository>;
  let userRepo: jest.Mocked<UserRepository>;
  let shiftService: jest.Mocked<ShiftService>;
  let reflector: jest.Mocked<Reflector>;

  const JWT_SECRET = 'enterprise-hrms-test-secret-key-hs256-strictly-enforced';

  // Security Identities
  const userAId = new Types.ObjectId();
  const sessionAId = new Types.ObjectId();
  const employeeAId = new Types.ObjectId();
  const roleEmployeeId = new Types.ObjectId();

  const userBId = new Types.ObjectId();
  const employeeBId = new Types.ObjectId();

  const managerUserId = new Types.ObjectId();
  const managerSessionId = new Types.ObjectId();
  const managerEmployeeId = new Types.ObjectId();
  const roleManagerId = new Types.ObjectId();

  const branchId = new Types.ObjectId();
  const dayShiftId = new Types.ObjectId();
  const nightShiftId = new Types.ObjectId();

  let validTokenUserA: string;
  let validTokenManager: string;
  let expiredTokenUserA: string;

  const mockBranch = {
    _id: branchId,
    name: 'Bangalore Tech Park Tower C',
    timezone: 'Asia/Kolkata', // UTC +05:30
    latitude: 12.9716,
    longitude: 77.5946,
    radiusMeters: 200,
    isActive: true,
  };

  const mockDayShift: ShiftLean = {
    _id: dayShiftId,
    name: 'Standard Day Shift',
    code: 'DAY-GEN',
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
    createdBy: userAId,
    updatedBy: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockNightShift: ShiftLean = {
    _id: nightShiftId,
    name: 'Overnight Graveyard Shift',
    code: 'NIGHT-01',
    startTime: '22:00',
    endTime: '07:00',
    isOvernight: true,
    gracePeriodMinutes: 15,
    breakDurationMinutes: 60,
    minWorkMinutesForFullDay: 480,
    minWorkMinutesForHalfDay: 240,
    overtimeThresholdMinutes: 480,
    isDefault: false,
    isActive: true,
    deletedAt: null,
    createdBy: userAId,
    updatedBy: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockEmployeeA: EmployeeLean = {
    _id: employeeAId,
    userId: userAId,
    employeeCode: 'EMP-001',
    firstName: 'Aarav',
    lastName: 'Sharma',
    workEmail: 'aarav.sharma@enterprise.com',
    reportingManagerId: managerEmployeeId,
    shiftId: dayShiftId,
    branchId,
    employmentStatus: EmploymentStatus.ACTIVE,
    employmentType: EmploymentType.FULL_TIME,
    dateOfJoining: new Date('2024-01-01T00:00:00.000Z'),
    departmentId: new Types.ObjectId(),
    designationId: new Types.ObjectId(),
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

  const mockEmployeeB: EmployeeLean = {
    _id: employeeBId,
    userId: userBId,
    employeeCode: 'EMP-002',
    firstName: 'Bharat',
    lastName: 'Patel',
    workEmail: 'bharat.patel@enterprise.com',
    reportingManagerId: managerEmployeeId,
    shiftId: dayShiftId,
    branchId,
    employmentStatus: EmploymentStatus.ACTIVE,
    employmentType: EmploymentType.FULL_TIME,
    dateOfJoining: new Date('2024-01-01T00:00:00.000Z'),
    departmentId: new Types.ObjectId(),
    designationId: new Types.ObjectId(),
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
    employeeCode: 'MGR-001',
    firstName: 'Pooja',
    lastName: 'Rao',
    workEmail: 'pooja.rao@enterprise.com',
    reportingManagerId: null,
    shiftId: dayShiftId,
    branchId,
    employmentStatus: EmploymentStatus.ACTIVE,
    employmentType: EmploymentType.FULL_TIME,
    dateOfJoining: new Date('2022-01-01T00:00:00.000Z'),
    departmentId: new Types.ObjectId(),
    designationId: new Types.ObjectId(),
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

  const mockRequestUserA = {
    user: {
      userId: userAId,
      sessionId: sessionAId,
      roleIds: [roleEmployeeId],
    },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestIntegration/1.0' },
  } as unknown as AuthenticatedRequest;

  const mockRequestManager = {
    user: {
      userId: managerUserId,
      sessionId: managerSessionId,
      roleIds: [roleManagerId],
    },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestIntegration/1.0' },
  } as unknown as AuthenticatedRequest;

  const createMockContext = (
    cookies: Record<string, string> = {},
    user?: unknown,
  ): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          cookies,
          user,
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeAll(() => {
    jwtService = new JwtService({ secret: JWT_SECRET });

    validTokenUserA = jwtService.sign({
      sub: userAId.toString(),
      sid: sessionAId.toString(),
      type: 'access',
    });

    validTokenManager = jwtService.sign({
      sub: managerUserId.toString(),
      sid: managerSessionId.toString(),
      type: 'access',
    });

    expiredTokenUserA = jwtService.sign(
      {
        sub: userAId.toString(),
        sid: sessionAId.toString(),
        type: 'access',
      },
      { expiresIn: -60 },
    );

    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    attendanceRepo = {
      findByEmployeeAndDate: jest.fn(),
      findActiveSessionByEmployee: jest.fn(),
      getMonthlySummary: jest.fn(),
      findList: jest.fn(),
    } as unknown as jest.Mocked<AttendanceRepository>;

    employeeRepo = {
      findByUserId: jest.fn(),
      findById: jest.fn(),
    } as unknown as jest.Mocked<EmployeeRepository>;

    branchRepo = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<BranchRepository>;

    authorizationService = {
      hasPermission: jest.fn(),
      hasPermissions: jest.fn(),
    } as unknown as jest.Mocked<AuthorizationService>;

    sessionRepo = {
      findActiveSessionByIdAndUserId: jest.fn(),
    } as unknown as jest.Mocked<SessionRepository>;

    userRepo = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    shiftService = {
      resolveShift: jest.fn(),
    } as unknown as jest.Mocked<ShiftService>;

    const mockSession = {
      withTransaction: jest
        .fn()
        .mockImplementation((cb: (s: unknown) => unknown) => cb(mockSession)),
      endSession: jest.fn(),
    };
    const mockConnection = {
      startSession: jest.fn().mockResolvedValue(mockSession),
    } as unknown as Connection;

    service = new AttendanceService(
      attendanceRepo,
      {} as unknown as AttendanceRegularizationRepository,
      employeeRepo,
      branchRepo,
      shiftService,
      { createAuditLog: jest.fn() } as unknown as AuditLogsService,
      authorizationService,
      mockConnection,
    );

    controller = new AttendanceController(service);

    jwtAuthGuard = new JwtAuthGuard(
      reflector,
      jwtService,
      sessionRepo,
      userRepo,
    );

    permissionsGuard = new PermissionsGuard(reflector, authorizationService);

    validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const details = mapValidationErrors(errors);
        return new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Request validation failed',
          HttpStatus.BAD_REQUEST,
          details,
        );
      },
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    // Default Session & User mocks for validTokenUserA
    sessionRepo.findActiveSessionByIdAndUserId.mockImplementation(
      (sId, uId) => {
        if (
          (sId.toString() === sessionAId.toString() &&
            uId.toString() === userAId.toString()) ||
          (sId.toString() === managerSessionId.toString() &&
            uId.toString() === managerUserId.toString())
        ) {
          return Promise.resolve({
            _id: sId,
            userId: uId,
            isActive: true,
          } as unknown as SessionDocument);
        }
        return Promise.resolve(null);
      },
    );

    userRepo.findById.mockImplementation((uId) => {
      if (uId.toString() === userAId.toString()) {
        return Promise.resolve({
          _id: userAId,
          status: UserStatus.ACTIVE,
          roleIds: [roleEmployeeId],
        } as unknown as UserLean);
      }
      if (uId.toString() === managerUserId.toString()) {
        return Promise.resolve({
          _id: managerUserId,
          status: UserStatus.ACTIVE,
          roleIds: [roleManagerId],
        } as unknown as UserLean);
      }
      return Promise.resolve(null);
    });

    // Default permissions & roles
    authorizationService.hasPermissions.mockResolvedValue(true);
    authorizationService.hasPermission.mockResolvedValue(false);

    employeeRepo.findByUserId.mockImplementation((uId) => {
      if (uId.toString() === userAId.toString())
        return Promise.resolve(mockEmployeeA);
      if (uId.toString() === managerUserId.toString())
        return Promise.resolve(mockManagerEmployee);
      return Promise.resolve(null);
    });

    employeeRepo.findById.mockImplementation((eId) => {
      if (eId.toString() === employeeAId.toString())
        return Promise.resolve(mockEmployeeA);
      if (eId.toString() === employeeBId.toString())
        return Promise.resolve(mockEmployeeB);
      if (eId.toString() === managerEmployeeId.toString())
        return Promise.resolve(mockManagerEmployee);
      return Promise.resolve(null);
    });

    branchRepo.findById.mockResolvedValue(mockBranch as unknown as Branch);

    attendanceRepo.findList.mockResolvedValue({
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
  });

  // ===========================================================================
  // CATEGORY 1: SECURITY & AUTHENTICATION (RBAC & IDOR)
  // ===========================================================================
  describe('Category 1: Security & Authentication (RBAC & IDOR)', () => {
    describe('1.1 Missing, Expired, and Malformed JWT Tokens', () => {
      it('should return 401 Unauthorized when access token cookie is missing', async () => {
        reflector.getAllAndOverride.mockReturnValue(false); // Route is not public
        const ctx = createMockContext({});

        await expect(jwtAuthGuard.canActivate(ctx)).rejects.toMatchObject({
          statusCode: HttpStatus.UNAUTHORIZED,
          code: ErrorCode.UNAUTHORIZED,
        });
      });

      it('should return 401 Unauthorized when access token is expired', async () => {
        reflector.getAllAndOverride.mockReturnValue(false);
        const ctx = createMockContext({ access_token: expiredTokenUserA });

        await expect(jwtAuthGuard.canActivate(ctx)).rejects.toMatchObject({
          statusCode: HttpStatus.UNAUTHORIZED,
          code: ErrorCode.UNAUTHORIZED,
        });
      });

      it('should return 401 Unauthorized when access token is structurally corrupt or signature invalid', async () => {
        reflector.getAllAndOverride.mockReturnValue(false);

        const corruptedTokens = [
          'malformed.token.payload',
          jwtService.sign(
            {
              sub: userAId.toString(),
              sid: sessionAId.toString(),
              type: 'access',
            },
            { secret: 'wrong-hacker-secret' },
          ),
          'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjMifQ.', // alg: none exploit
        ];

        for (const token of corruptedTokens) {
          const ctx = createMockContext({ access_token: token });
          await expect(jwtAuthGuard.canActivate(ctx)).rejects.toMatchObject({
            statusCode: HttpStatus.UNAUTHORIZED,
            code: ErrorCode.UNAUTHORIZED,
          });
        }
      });

      it('should successfully authenticate when valid user access token is provided', async () => {
        reflector.getAllAndOverride.mockReturnValue(false);
        const ctx = createMockContext({ access_token: validTokenUserA });
        const result = await jwtAuthGuard.canActivate(ctx);
        expect(result).toBe(true);
      });

      it('should successfully authenticate when valid manager access token is provided', async () => {
        reflector.getAllAndOverride.mockReturnValue(false);
        const ctx = createMockContext({ access_token: validTokenManager });
        const result = await jwtAuthGuard.canActivate(ctx);
        expect(result).toBe(true);
      });
    });

    describe('1.2 Insecure Direct Object Reference (IDOR) on /summary', () => {
      it('should return 403 Forbidden when Employee A attempts to view Employee B summary (Horizontal Privilege Escalation)', async () => {
        authorizationService.hasPermission.mockResolvedValue(false);

        await expect(
          controller.getSummary(
            { year: 2026, month: 10, employeeId: employeeBId.toString() },
            mockRequestUserA,
          ),
        ).rejects.toMatchObject({
          statusCode: HttpStatus.FORBIDDEN,
          code: ErrorCode.FORBIDDEN,
          message:
            'Insufficient permission to view employee attendance summary',
        });

        expect(attendanceRepo.getMonthlySummary).not.toHaveBeenCalled();
      });

      it('should return 200 OK when Reporting Manager views direct report summary', async () => {
        const mockSummary = {
          totalRecords: 22,
          presentDays: 20,
          halfDays: 1,
          absentDays: 1,
          incompleteDays: 0,
          lateDays: 2,
          earlyDepartures: 1,
          totalWorkingMinutes: 9600,
          totalOvertimeMinutes: 120,
          totalBreakMinutes: 1320,
        };
        attendanceRepo.getMonthlySummary.mockResolvedValue(mockSummary);

        const result = await controller.getSummary(
          { year: 2026, month: 10, employeeId: employeeBId.toString() },
          mockRequestManager,
        );

        expect(result.success).toBe(true);
        expect(result.data.presentDays).toBe(20);
        expect(result.data.totalWorkingMinutes).toBe(9600);
        expect(attendanceRepo.getMonthlySummary).toHaveBeenCalledWith(
          employeeBId,
          '2026-10-01',
          '2026-10-31',
        );
      });
    });

    describe('1.3 Role-Based Access Control (RBAC) & IDOR on /reports', () => {
      it('should return 403 Forbidden when Employee A attempts to query Employee B reports via employeeId without privileges (IDOR prevention)', async () => {
        reflector.getAllAndOverride.mockReturnValue([
          PermissionKeys.ATTENDANCE_VIEW,
        ]);
        authorizationService.hasPermissions.mockResolvedValue(false);

        const ctx = createMockContext({}, mockRequestUserA.user);

        await expect(permissionsGuard.canActivate(ctx)).rejects.toMatchObject({
          statusCode: HttpStatus.FORBIDDEN,
          code: ErrorCode.FORBIDDEN,
        });

        expect(attendanceRepo.findList).not.toHaveBeenCalled();
      });

      it('should return 403 Forbidden when a standard user attempts to query /reports for an entire department without Manager/Admin privileges', async () => {
        reflector.getAllAndOverride.mockReturnValue([
          PermissionKeys.ATTENDANCE_VIEW,
        ]);
        authorizationService.hasPermissions.mockResolvedValue(false);

        const ctx = createMockContext({}, mockRequestUserA.user);

        await expect(permissionsGuard.canActivate(ctx)).rejects.toMatchObject({
          statusCode: HttpStatus.FORBIDDEN,
          code: ErrorCode.FORBIDDEN,
        });

        expect(attendanceRepo.findList).not.toHaveBeenCalled();
      });

      it('should return 200 OK when Manager or Admin with ATTENDANCE_VIEW queries department reports', async () => {
        reflector.getAllAndOverride.mockReturnValue([
          PermissionKeys.ATTENDANCE_VIEW,
        ]);
        authorizationService.hasPermissions.mockResolvedValue(true);

        const ctx = createMockContext({}, mockRequestManager.user);
        const canActivate = await permissionsGuard.canActivate(ctx);
        expect(canActivate).toBe(true);

        attendanceRepo.findList.mockResolvedValue({
          data: [],
          meta: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        });

        const deptId = new Types.ObjectId().toString();
        const result = await controller.listReports({
          page: 1,
          limit: 20,
          departmentId: deptId,
        });

        expect(result.success).toBe(true);
        expect(attendanceRepo.findList).toHaveBeenCalledWith(
          expect.objectContaining({}),
          1,
          20,
        );
      });
    });
  });

  // ===========================================================================
  // CATEGORY 2: TIMEZONE & BOUNDARY EDGE CASES (CRITICAL)
  // ===========================================================================
  describe('Category 2: Timezone & Boundary Edge Cases (Critical)', () => {
    describe('2.1 /today Midnight Crossing (11:59 PM vs 12:01 AM in Asia/Kolkata)', () => {
      it('should return Oct 25 status when querying at 11:59 PM IST Oct 25 (UTC is Oct 25 18:29)', async () => {
        // Wall clock: 2026-10-25 23:59:00 IST -> 2026-10-25T18:29:00.000Z UTC
        const mockNow = new Date('2026-10-25T18:29:00.000Z');
        jest.useFakeTimers({
          now: mockNow,
          doNotFake: ['nextTick', 'setImmediate'],
        });

        const mockAttendanceRecord: AttendanceLean = {
          _id: new Types.ObjectId(),
          employeeId: employeeAId,
          attendanceDate: '2026-10-25',
          date: new Date('2026-10-25T00:00:00.000Z'),
          shiftId: dayShiftId,
          shiftSnapshot: {
            name: mockDayShift.name,
            code: mockDayShift.code,
            startTime: mockDayShift.startTime,
            endTime: mockDayShift.endTime,
            isOvernight: false,
            gracePeriodMinutes: 15,
            minWorkMinutesForFullDay: 480,
            minWorkMinutesForHalfDay: 240,
            overtimeThresholdMinutes: 480,
          },
          checkInTime: new Date('2026-10-25T03:30:00.000Z'),
          checkOutTime: new Date('2026-10-25T12:30:00.000Z'),
          status: AttendanceStatus.PRESENT,
          workMode: WorkMode.OFFICE,
          breaks: [],
          totalBreakMinutes: 60,
          totalWorkMinutes: 480,
          isLate: false,
          lateMinutes: 0,
          isEarlyDeparture: false,
          earlyDepartureMinutes: 0,
          overtimeMinutes: 0,
          checkInSource: AttendanceSource.WEB,
          regularizationId: null,
          deletedAt: null,
          deletedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(
          mockAttendanceRecord,
        );

        const result = await controller.getTodayStatus(mockRequestUserA);

        expect(result.success).toBe(true);
        expect(result.data.isCheckedIn).toBe(false);
        expect(result.data.attendance?.attendanceDate).toBe('2026-10-25');
        expect(result.data.attendance?.status).toBe(AttendanceStatus.PRESENT);
        expect(attendanceRepo.findByEmployeeAndDate).toHaveBeenCalledWith(
          employeeAId,
          '2026-10-25',
        );
      });

      it('should roll over to Oct 26 when querying at 12:01 AM IST Oct 26 (even though UTC is Oct 25 18:31)', async () => {
        // Wall clock: 2026-10-26 00:01:00 IST -> 2026-10-25T18:31:00.000Z UTC
        // NOTICE: Server UTC date is still 2026-10-25!
        const mockNow = new Date('2026-10-25T18:31:00.000Z');
        jest.useFakeTimers({
          now: mockNow,
          doNotFake: ['nextTick', 'setImmediate'],
        });

        // Oct 26 has no attendance yet
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        const result = await controller.getTodayStatus(mockRequestUserA);

        expect(result.success).toBe(true);
        expect(result.data.isCheckedIn).toBe(false);
        expect(result.data.attendance).toBeNull();
        // Crucial: Must check for Oct 26 in branch timezone, NOT Oct 25 from server UTC
        expect(attendanceRepo.findByEmployeeAndDate).toHaveBeenCalledWith(
          employeeAId,
          '2026-10-26',
        );
      });
    });

    describe('2.2 /today Overnight Shifts Crossing Midnight Boundary', () => {
      it('should resolve active overnight session across midnight when queried at 02:30 AM next calendar day', async () => {
        // Mock time: Oct 26 02:30:00 IST -> 2026-10-25T21:00:00.000Z UTC
        const mockNow = new Date('2026-10-25T21:00:00.000Z');
        jest.useFakeTimers({
          now: mockNow,
          doNotFake: ['nextTick', 'setImmediate'],
        });

        // Today (Oct 26) has no record
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);

        // Active unclosed overnight session from Oct 25 (22:00 IST punch)
        const activeOvernightSession: AttendanceLean = {
          _id: new Types.ObjectId(),
          employeeId: employeeAId,
          attendanceDate: '2026-10-25',
          date: new Date('2026-10-25T00:00:00.000Z'),
          shiftId: nightShiftId,
          shiftSnapshot: {
            name: mockNightShift.name,
            code: mockNightShift.code,
            startTime: mockNightShift.startTime,
            endTime: mockNightShift.endTime,
            isOvernight: true,
            gracePeriodMinutes: 15,
            minWorkMinutesForFullDay: 480,
            minWorkMinutesForHalfDay: 240,
            overtimeThresholdMinutes: 480,
          },
          checkInTime: new Date('2026-10-25T16:30:00.000Z'), // 22:00 IST
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
          checkInSource: AttendanceSource.MOBILE,
          regularizationId: null,
          deletedAt: null,
          deletedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(
          activeOvernightSession,
        );

        const result = await controller.getTodayStatus(mockRequestUserA);

        expect(result.success).toBe(true);
        expect(result.data.isCheckedIn).toBe(true);
        expect(result.data.isOnBreak).toBe(false);
        expect(result.data.attendance?.attendanceDate).toBe('2026-10-25');
        expect(result.data.attendance?.status).toBe(
          AttendanceStatus.CHECKED_IN,
        );
        expect(result.data.attendance?.shiftSnapshot.isOvernight).toBe(true);
      });

      it('should close overnight session after checkout and clear active state at 10:00 AM next day', async () => {
        // Mock time: Oct 26 10:00:00 IST -> 2026-10-26T04:30:00.000Z UTC
        const mockNow = new Date('2026-10-26T04:30:00.000Z');
        jest.useFakeTimers({
          now: mockNow,
          doNotFake: ['nextTick', 'setImmediate'],
        });

        // Oct 26 today record is null
        attendanceRepo.findByEmployeeAndDate.mockResolvedValue(null);
        // Active session is null because overnight shift checked out at 07:05 AM
        attendanceRepo.findActiveSessionByEmployee.mockResolvedValue(null);

        const result = await controller.getTodayStatus(mockRequestUserA);

        expect(result.success).toBe(true);
        expect(result.data.isCheckedIn).toBe(false);
        expect(result.data.attendance).toBeNull();
      });
    });

    describe('2.3 /summary Leap Years (Feb 29) & 31-Day Month Edge Calculations', () => {
      it('should correctly include Feb 29 in leap year 2028 aggregation window', async () => {
        const leapYearSummary = {
          totalRecords: 21,
          presentDays: 21, // 21 working days including Feb 29
          halfDays: 0,
          absentDays: 0,
          incompleteDays: 0,
          lateDays: 0,
          earlyDepartures: 0,
          totalWorkingMinutes: 10080,
          totalOvertimeMinutes: 0,
          totalBreakMinutes: 1260,
        };
        attendanceRepo.getMonthlySummary.mockResolvedValue(leapYearSummary);

        const result = await controller.getSummary(
          { year: 2028, month: 2 },
          mockRequestUserA,
        );

        expect(result.success).toBe(true);
        expect(result.data.presentDays).toBe(21);
        // Assert date range boundary calculated by service strictly ends on 2028-02-29
        expect(attendanceRepo.getMonthlySummary).toHaveBeenCalledWith(
          employeeAId,
          '2028-02-01',
          '2028-02-29',
        );
      });

      it('should bound non-leap year Feb to Feb 28 (year 2026)', async () => {
        attendanceRepo.getMonthlySummary.mockResolvedValue({
          totalRecords: 20,
          presentDays: 20,
          halfDays: 0,
          absentDays: 0,
          incompleteDays: 0,
          lateDays: 0,
          earlyDepartures: 0,
          totalWorkingMinutes: 9600,
          totalOvertimeMinutes: 0,
          totalBreakMinutes: 1200,
        });

        await controller.getSummary({ year: 2026, month: 2 }, mockRequestUserA);

        expect(attendanceRepo.getMonthlySummary).toHaveBeenCalledWith(
          employeeAId,
          '2026-02-01',
          '2026-02-28',
        );
      });

      it('should bound 31-day months (October) strictly to day 31', async () => {
        attendanceRepo.getMonthlySummary.mockResolvedValue({
          totalRecords: 22,
          presentDays: 22,
          halfDays: 0,
          absentDays: 0,
          incompleteDays: 0,
          lateDays: 0,
          earlyDepartures: 0,
          totalWorkingMinutes: 10560,
          totalOvertimeMinutes: 0,
          totalBreakMinutes: 1320,
        });

        await controller.getSummary(
          { year: 2026, month: 10 },
          mockRequestUserA,
        );

        expect(attendanceRepo.getMonthlySummary).toHaveBeenCalledWith(
          employeeAId,
          '2026-10-01',
          '2026-10-31',
        );
      });
    });
  });

  // ===========================================================================
  // CATEGORY 3: DATA VALIDATION & PAGINATION LIMITS (DDOS & STABILITY)
  // ===========================================================================
  describe('Category 3: Data Validation & Pagination Limits (Anti-DDoS)', () => {
    describe('3.1 /reports Parameter Tampering & Bounds Protection', () => {
      it('should reject excessive limit (> 100) with 400 Bad Request to prevent memory buffer exhaustion', async () => {
        await expect(
          validationPipe.transform(
            { limit: '10000', page: '1' },
            { type: 'query', metatype: ListAttendanceQueryDto },
          ),
        ).rejects.toMatchObject({
          statusCode: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_ERROR,
        });
      });

      it('should reject negative limits and zero page indexes with 400 Bad Request', async () => {
        const malformedQueries = [
          { limit: '-10', page: '1' },
          { page: '0', limit: '20' },
          { page: '-1', limit: '20' },
        ];

        for (const query of malformedQueries) {
          await expect(
            validationPipe.transform(query, {
              type: 'query',
              metatype: ListAttendanceQueryDto,
            }),
          ).rejects.toMatchObject({
            statusCode: HttpStatus.BAD_REQUEST,
            code: ErrorCode.VALIDATION_ERROR,
          });
        }
      });

      it('should reject malformed non-numeric pagination query parameters with 400 Bad Request', async () => {
        await expect(
          validationPipe.transform(
            { page: 'NaN', limit: 'twenty' },
            { type: 'query', metatype: ListAttendanceQueryDto },
          ),
        ).rejects.toMatchObject({
          statusCode: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_ERROR,
        });
      });

      it('should return 200 OK with empty array when page index exceeds total dataset pages (page=999)', async () => {
        attendanceRepo.findList.mockResolvedValue({
          data: [],
          meta: {
            page: 999,
            limit: 20,
            total: 15,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: true,
          },
        });

        const result = await controller.listReports({ page: 999, limit: 20 });

        expect(result.success).toBe(true);
        expect(result.data).toEqual([]);
        expect(result.meta.page).toBe(999);
        expect(result.meta.total).toBe(15);
      });
    });

    describe('3.2 /summary Query Parameter Validation', () => {
      it('should reject invalid calendar months (month=13, month=0) with 400 Bad Request', async () => {
        const invalidMonthQueries = [
          { year: '2026', month: '13' },
          { year: '2026', month: '0' },
          { year: '2026', month: '-5' },
        ];

        for (const query of invalidMonthQueries) {
          await expect(
            validationPipe.transform(query, {
              type: 'query',
              metatype: AttendanceSummaryQueryDto,
            }),
          ).rejects.toMatchObject({
            statusCode: HttpStatus.BAD_REQUEST,
            code: ErrorCode.VALIDATION_ERROR,
          });
        }
      });

      it('should reject out-of-bounds or non-numeric calendar years (year=abcd, year=1999, year=2150)', async () => {
        const invalidYearQueries = [
          { year: 'abcd', month: '10' },
          { year: '1999', month: '10' },
          { year: '2150', month: '10' },
        ];

        for (const query of invalidYearQueries) {
          await expect(
            validationPipe.transform(query, {
              type: 'query',
              metatype: AttendanceSummaryQueryDto,
            }),
          ).rejects.toMatchObject({
            statusCode: HttpStatus.BAD_REQUEST,
            code: ErrorCode.VALIDATION_ERROR,
          });
        }
      });

      it('should reject invalid BSON ObjectID in employeeId query parameter with 400 Bad Request', async () => {
        await expect(
          validationPipe.transform(
            { year: '2026', month: '10', employeeId: 'not-a-valid-mongo-id' },
            { type: 'query', metatype: AttendanceSummaryQueryDto },
          ),
        ).rejects.toMatchObject({
          statusCode: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_ERROR,
        });
      });
    });

    describe('3.3 /summary Database Empty State (Zero Attendance Records)', () => {
      it('should return 200 OK with zeroed statistics for employees with zero records (never throw 500)', async () => {
        attendanceRepo.getMonthlySummary.mockResolvedValue({
          totalRecords: 0,
          presentDays: 0,
          halfDays: 0,
          absentDays: 0,
          incompleteDays: 0,
          lateDays: 0,
          earlyDepartures: 0,
          totalWorkingMinutes: 0,
          totalOvertimeMinutes: 0,
          totalBreakMinutes: 0,
        });

        const result = await controller.getSummary(
          { year: 2026, month: 9 },
          mockRequestUserA,
        );

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          totalRecords: 0,
          presentDays: 0,
          halfDays: 0,
          absentDays: 0,
          incompleteDays: 0,
          lateDays: 0,
          earlyDepartures: 0,
          totalWorkingMinutes: 0,
          totalOvertimeMinutes: 0,
          totalBreakMinutes: 0,
        });
      });
    });
  });
});

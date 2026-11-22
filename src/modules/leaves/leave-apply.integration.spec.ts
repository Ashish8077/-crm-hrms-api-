import {
  HttpStatus,
  ValidationPipe,
  ValidationError,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Connection, Types, ClientSession } from 'mongoose';

import { LeavesController } from './leaves.controller';
import { LeavesService } from './services/leaves.service';
import {
  LeaveTypeRepository,
  LeaveTypeLean,
} from './repositories/leave-type.repository';
import {
  LeaveBalanceRepository,
  LeaveBalanceLean,
} from './repositories/leave-balance.repository';
import {
  LeaveTransactionRepository,
  LeaveTransactionLean,
} from './repositories/leave-transaction.repository';
import {
  LeaveRequestRepository,
  LeaveRequestLean,
} from './repositories/leave-request.repository';
import {
  HolidayRepository,
  HolidayLean,
} from './repositories/holiday.repository';
import { CompOffRepository } from './repositories/comp-off-record.repository';
import {
  EmployeeRepository,
  EmployeeLean,
} from '../employees/repositories/employee.repository';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { AttendanceRepository } from '../attendance/repositories/attendance.repository';
import { ShiftService } from '../attendance/services/shift.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { SessionRepository } from '../auth/repositories/session.repository';
import {
  UserRepository,
  UserLean,
} from '../users/repositories/user.repository';
import { SessionDocument } from '../auth/schemas/session.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { WeeklyOffService } from '../work-schedules/services/weekly-off.service';
import { LeaveCalculationUtil } from './utils/leave-calculation.util';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import { UserStatus } from '../users/constants/user-status.constant';
import {
  HalfDaySession,
  HolidayType,
  LeaveRequestStatus,
  LeaveTransactionType,
} from './constants/leaves.constant';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { ApplyLeaveDto } from './dto/apply-leave.dto';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('Apply for Leave API Production Integration Suite (POST /api/v1/leaves/requests)', () => {
  let controller: LeavesController;
  let leavesService: LeavesService;
  let validationPipe: ValidationPipe;
  let jwtAuthGuard: JwtAuthGuard;
  let permissionsGuard: PermissionsGuard;
  let jwtService: JwtService;
  let reflector: jest.Mocked<Reflector>;

  // Security Identities
  const JWT_SECRET = 'enterprise-hrms-apply-leave-integration-secret-hs256';
  const employeeUserId = new Types.ObjectId();
  const employeeSessionId = new Types.ObjectId();
  const employeeRoleId = new Types.ObjectId();

  const unauthorizedUserId = new Types.ObjectId();
  const unauthorizedSessionId = new Types.ObjectId();
  const unauthorizedRoleId = new Types.ObjectId();

  let validEmployeeToken: string;
  let unauthorizedToken: string;

  // In-memory Stateful Stores for isolated integration execution
  const employeesStore = new Map<string, EmployeeLean>();
  const leaveTypesStore = new Map<string, LeaveTypeLean>();
  const leaveBalancesStore = new Map<string, LeaveBalanceLean>();
  const leaveRequestsStore = new Map<string, LeaveRequestLean>();
  const leaveTransactionsStore: LeaveTransactionLean[] = [];
  const holidaysStore: HolidayLean[] = [];
  const weeklyOffsStore = new Set<string>();
  const auditLogsStore: Array<{
    actorId: Types.ObjectId;
    action: string;
    targetModel: string;
    targetId: Types.ObjectId;
    details: Record<string, unknown>;
  }> = [];

  const balanceKey = (
    empId: Types.ObjectId | string,
    ltId: Types.ObjectId | string,
    yr: number,
  ) => `${empId.toString()}_${ltId.toString()}_${yr}`;

  // Mock Repositories
  let mockLeaveTypeRepo: jest.Mocked<LeaveTypeRepository>;
  let mockLeaveBalanceRepo: jest.Mocked<LeaveBalanceRepository>;
  let mockLeaveRequestRepo: jest.Mocked<LeaveRequestRepository>;
  let mockLeaveTransactionRepo: jest.Mocked<LeaveTransactionRepository>;
  let mockHolidayRepo: jest.Mocked<HolidayRepository>;
  let mockEmployeeRepo: jest.Mocked<EmployeeRepository>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;
  let mockAuthorizationService: jest.Mocked<AuthorizationService>;
  let mockSessionRepo: jest.Mocked<SessionRepository>;
  let mockUserRepo: jest.Mocked<UserRepository>;
  let mockWeeklyOffService: jest.Mocked<WeeklyOffService>;

  // Entity Factories
  const createEmployee = (overrides?: Partial<EmployeeLean>): EmployeeLean => {
    const empId = new Types.ObjectId();
    const employee: EmployeeLean = {
      _id: empId,
      userId: employeeUserId,
      employeeCode: `EMP-${Date.now().toString().slice(-4)}`,
      firstName: 'Rahul',
      lastName: 'Verma',
      workEmail: `rahul.${Date.now()}@enterprise.com`,
      reportingManagerId: new Types.ObjectId(),
      shiftId: new Types.ObjectId(),
      branchId: new Types.ObjectId(),
      employmentStatus: EmploymentStatus.ACTIVE,
      employmentType: EmploymentType.FULL_TIME,
      dateOfJoining: new Date('2023-01-01'),
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
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    employeesStore.set(employee._id.toString(), employee);
    return employee;
  };

  const createLeaveType = (
    overrides?: Partial<LeaveTypeLean>,
  ): LeaveTypeLean => {
    const ltId = new Types.ObjectId();
    const leaveType: LeaveTypeLean = {
      _id: ltId,
      name: 'Paid Annual Leave',
      code: `AL-${Date.now().toString().slice(-3)}`,
      isPaid: true,
      annualAllocation: 18,
      allowHalfDay: true,
      allowNegativeBalance: false,
      allowDuringNoticePeriod: false,
      applicableEmploymentStatuses: [
        EmploymentStatus.ACTIVE,
        EmploymentStatus.PROBATION,
      ],
      deductWeekends: false,
      deductHolidays: false,
      maxConsecutiveDays: 14,
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
      ...overrides,
    };
    leaveTypesStore.set(leaveType._id.toString(), leaveType);
    return leaveType;
  };

  const seedBalance = (
    employeeId: Types.ObjectId,
    leaveTypeId: Types.ObjectId,
    year: number,
    allocatedDays: number,
    usedDays = 0,
    pendingDays = 0,
  ): LeaveBalanceLean => {
    const key = balanceKey(employeeId, leaveTypeId, year);
    const availableBalance = allocatedDays - usedDays - pendingDays;
    const balance: LeaveBalanceLean = {
      _id: new Types.ObjectId(),
      employeeId,
      leaveTypeId,
      year,
      allocatedDays,
      carriedForwardDays: 0,
      creditedDays: 0,
      debitedDays: 0,
      usedDays,
      pendingDays,
      availableBalance,
      deletedAt: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    leaveBalancesStore.set(key, balance);
    return balance;
  };

  const createMockContext = (
    token?: string,
    body?: unknown,
  ): ExecutionContext => {
    const req = {
      cookies: token ? { access_token: token } : {},
      headers: {
        'user-agent': 'JestIntegration/1.0',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ip: '127.0.0.1',
      body,
      user: undefined,
    } as unknown as AuthenticatedRequest;

    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(req),
        getResponse: jest.fn().mockReturnValue({}),
      }),
    } as unknown as ExecutionContext;
  };

  /**
   * Complete HTTP Pipeline Execution:
   * 1. ValidationPipe: Schema transform, validate, and error map
   * 2. JwtAuthGuard: Token verification and session attachment
   * 3. PermissionsGuard: LEAVES_CREATE RBAC check
   * 4. LeavesController: Resolves actor context and delegates to LeavesService
   */
  const executeApplyLeaveApi = async (
    rawPayload: unknown,
    token: string = validEmployeeToken,
  ) => {
    // 1. Validation Pipe execution
    const validatedDto = (await validationPipe.transform(rawPayload, {
      type: 'body',
      metatype: ApplyLeaveDto,
    })) as ApplyLeaveDto;

    // 2. Security Guards execution
    const ctx = createMockContext(token, rawPayload);
    reflector.getAllAndOverride.mockReturnValue(false); // Route is not public
    await jwtAuthGuard.canActivate(ctx);

    // Mock reflection for PermissionsGuard (requires LEAVE_REQUESTS_APPLY)
    reflector.getAllAndOverride.mockReturnValue([
      PermissionKeys.LEAVE_REQUESTS_APPLY,
    ]);
    await permissionsGuard.canActivate(ctx);

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return controller.applyLeave(validatedDto, req);
  };

  beforeAll(() => {
    jwtService = new JwtService({ secret: JWT_SECRET });

    validEmployeeToken = jwtService.sign({
      sub: employeeUserId.toString(),
      sid: employeeSessionId.toString(),
      type: 'access',
    });

    unauthorizedToken = jwtService.sign({
      sub: unauthorizedUserId.toString(),
      sid: unauthorizedSessionId.toString(),
      type: 'access',
    });

    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    mockLeaveTypeRepo = {
      findById: jest.fn(
        (id: Types.ObjectId | string): Promise<LeaveTypeLean | null> => {
          const found = leaveTypesStore.get(id.toString());
          return Promise.resolve(
            found && !found.deletedAt ? { ...found } : null,
          );
        },
      ),
    } as unknown as jest.Mocked<LeaveTypeRepository>;

    mockLeaveBalanceRepo = {
      reserveBalance: jest.fn(
        (
          employeeId: Types.ObjectId,
          leaveTypeId: Types.ObjectId,
          year: number,
          days: number,
          allowNegative: boolean,
        ): Promise<LeaveBalanceLean | null> => {
          const key = balanceKey(employeeId, leaveTypeId, year);
          const current = leaveBalancesStore.get(key);
          if (!current) {
            if (!allowNegative) return Promise.resolve(null);
            const created: LeaveBalanceLean = {
              _id: new Types.ObjectId(),
              employeeId,
              leaveTypeId,
              year,
              allocatedDays: 0,
              carriedForwardDays: 0,
              creditedDays: 0,
              debitedDays: 0,
              usedDays: 0,
              pendingDays: days,
              availableBalance: -days,
              deletedAt: null,
              updatedBy: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            leaveBalancesStore.set(key, created);
            return Promise.resolve(created);
          }

          if (current.availableBalance < days && !allowNegative) {
            return Promise.resolve(null);
          }

          current.pendingDays += days;
          current.availableBalance -= days;
          current.updatedAt = new Date();
          return Promise.resolve({ ...current });
        },
      ),
    } as unknown as jest.Mocked<LeaveBalanceRepository>;

    mockLeaveRequestRepo = {
      create: jest.fn(
        (data: Partial<LeaveRequestLean>): Promise<LeaveRequestLean> => {
          const id = (data._id as Types.ObjectId) || new Types.ObjectId();
          const doc: LeaveRequestLean = {
            ...data,
            _id: id,
          } as LeaveRequestLean;
          leaveRequestsStore.set(id.toString(), doc);
          return Promise.resolve(doc);
        },
      ),
      findOverlappingRequests: jest.fn(
        (
          employeeId: Types.ObjectId,
          startDate: string,
          endDate: string,
        ): Promise<LeaveRequestLean[]> => {
          const overlapping: LeaveRequestLean[] = [];
          for (const req of leaveRequestsStore.values()) {
            if (
              req.employeeId.toString() === employeeId.toString() &&
              [
                LeaveRequestStatus.PENDING,
                LeaveRequestStatus.APPROVED,
              ].includes(req.status)
            ) {
              // Check date intersection: req.startDate <= endDate && req.endDate >= startDate
              if (req.startDate <= endDate && req.endDate >= startDate) {
                overlapping.push({ ...req });
              }
            }
          }
          return Promise.resolve(overlapping);
        },
      ),
    } as unknown as jest.Mocked<LeaveRequestRepository>;

    mockLeaveTransactionRepo = {
      create: jest.fn(
        (
          data: Partial<LeaveTransactionLean>,
        ): Promise<LeaveTransactionLean> => {
          const record: LeaveTransactionLean = {
            _id: new Types.ObjectId(),
            createdAt: new Date(),
            ...data,
          } as LeaveTransactionLean;
          leaveTransactionsStore.push(record);
          return Promise.resolve(record);
        },
      ),
      findByReference: jest.fn(
        (
          referenceId: Types.ObjectId | string,
          transactionType: LeaveTransactionType,
        ): Promise<LeaveTransactionLean | null> => {
          const targetRef = referenceId.toString();
          const match = leaveTransactionsStore.find(
            (t) =>
              t.referenceId?.toString() === targetRef &&
              t.transactionType === transactionType,
          );
          return Promise.resolve(match ? { ...match } : null);
        },
      ),
      findList: jest.fn(
        (
          filter: Record<string, unknown> = {},
        ): Promise<{ data: LeaveTransactionLean[]; meta: unknown }> => {
          let items = [...leaveTransactionsStore];
          if (filter.referenceId) {
            const ref = filter.referenceId;
            const refStr =
              ref instanceof Types.ObjectId
                ? ref.toString()
                : typeof ref === 'string'
                  ? ref
                  : null;
            if (refStr) {
              items = items.filter((t) => t.referenceId?.toString() === refStr);
            }
          }
          if (filter.transactionType) {
            items = items.filter(
              (t) => t.transactionType === filter.transactionType,
            );
          }
          return Promise.resolve({
            data: items,
            meta: { total: items.length, page: 1, limit: 20 },
          });
        },
      ),
    } as unknown as jest.Mocked<LeaveTransactionRepository>;

    mockHolidayRepo = {
      findApplicableHolidays: jest.fn(
        (startDate: string, endDate: string): Promise<HolidayLean[]> => {
          const applicable = holidaysStore.filter(
            (h) => h.isActive && h.date >= startDate && h.date <= endDate,
          );
          return Promise.resolve(applicable);
        },
      ),
    } as unknown as jest.Mocked<HolidayRepository>;

    mockEmployeeRepo = {
      findByUserId: jest.fn(
        (userId: Types.ObjectId): Promise<EmployeeLean | null> => {
          for (const emp of employeesStore.values()) {
            if (
              emp.userId &&
              emp.userId.toString() === userId.toString() &&
              !emp.deletedAt
            ) {
              return Promise.resolve({ ...emp });
            }
          }
          return Promise.resolve(null);
        },
      ),
      findById: jest.fn((id: Types.ObjectId): Promise<EmployeeLean | null> => {
        const emp = employeesStore.get(id.toString());
        return Promise.resolve(emp && !emp.deletedAt ? { ...emp } : null);
      }),
      updateById: jest.fn(
        (
          id: Types.ObjectId,
          update: Partial<EmployeeLean>,
        ): Promise<EmployeeLean | null> => {
          const current = employeesStore.get(id.toString());
          if (!current) return Promise.resolve(null);
          Object.assign(current, update);
          return Promise.resolve({ ...current });
        },
      ),
    } as unknown as jest.Mocked<EmployeeRepository>;

    mockAuditLogsService = {
      createAuditLog: jest.fn(
        (data: {
          actorId: Types.ObjectId;
          action: string;
          targetModel: string;
          targetId: Types.ObjectId;
          details: Record<string, unknown>;
        }): Promise<void> => {
          auditLogsStore.push(data);
          return Promise.resolve();
        },
      ),
    } as unknown as jest.Mocked<AuditLogsService>;

    mockAuthorizationService = {
      hasPermission: jest.fn(),
      hasPermissions: jest.fn(),
    } as unknown as jest.Mocked<AuthorizationService>;

    mockSessionRepo = {
      findActiveSessionByIdAndUserId: jest.fn(),
    } as unknown as jest.Mocked<SessionRepository>;

    mockUserRepo = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    let transactionMutex = Promise.resolve();
    const mockSession: { withTransaction: jest.Mock; endSession: jest.Mock } = {
      withTransaction: jest.fn(),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    mockSession.withTransaction.mockImplementation(
      async (cb: (s: ClientSession) => Promise<unknown>) => {
        // Accurately models MongoDB document write locks on employee aggregate root
        const prev = transactionMutex;
        let release!: () => void;
        transactionMutex = new Promise<void>((resolve) => {
          release = resolve;
        });
        await prev;
        try {
          return await cb(mockSession as unknown as ClientSession);
        } finally {
          release();
        }
      },
    );

    const mockConnection = {
      startSession: jest.fn().mockResolvedValue(mockSession),
    } as unknown as Connection;

    mockWeeklyOffService = {
      getWeeklyOffDatesForRange: jest.fn(
        (startDate: string, endDate: string): Promise<Set<string>> => {
          const dates = new Set<string>();
          if (weeklyOffsStore.size > 0) {
            for (const d of weeklyOffsStore) {
              if (d >= startDate && d <= endDate) {
                dates.add(d);
              }
            }
          } else {
            const allDates = LeaveCalculationUtil.enumerateDateStrings(
              startDate,
              endDate,
            );
            for (const d of allDates) {
              if (LeaveCalculationUtil.isWeekend(d, [0])) {
                dates.add(d);
              }
            }
          }
          return Promise.resolve(dates);
        },
      ),
      isWeeklyOff: jest.fn((date: string): Promise<boolean> => {
        if (weeklyOffsStore.size > 0) {
          return Promise.resolve(weeklyOffsStore.has(date));
        }
        return Promise.resolve(LeaveCalculationUtil.isWeekend(date, [0]));
      }),
    } as unknown as jest.Mocked<WeeklyOffService>;

    leavesService = new LeavesService(
      mockLeaveTypeRepo,
      mockHolidayRepo,
      mockLeaveBalanceRepo,
      mockLeaveRequestRepo,
      mockLeaveTransactionRepo,
      {} as CompOffRepository,
      mockEmployeeRepo,
      {} as BranchRepository,
      {} as AttendanceRepository,
      {} as ShiftService,
      mockAuditLogsService,
      mockAuthorizationService,
      mockConnection,
      mockWeeklyOffService,
    );

    controller = new LeavesController(leavesService);

    jwtAuthGuard = new JwtAuthGuard(
      reflector,
      jwtService,
      mockSessionRepo,
      mockUserRepo,
    );

    permissionsGuard = new PermissionsGuard(
      reflector,
      mockAuthorizationService,
    );

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
    employeesStore.clear();
    leaveTypesStore.clear();
    leaveBalancesStore.clear();
    leaveRequestsStore.clear();
    leaveTransactionsStore.length = 0;
    holidaysStore.length = 0;
    weeklyOffsStore.clear();
    auditLogsStore.length = 0;
    jest.clearAllMocks();

    mockSessionRepo.findActiveSessionByIdAndUserId.mockImplementation(
      (sId, uId) => {
        if (
          sId.toString() === employeeSessionId.toString() &&
          uId.toString() === employeeUserId.toString()
        ) {
          return Promise.resolve({
            _id: sId,
            userId: uId,
            isActive: true,
          } as unknown as SessionDocument);
        }
        if (
          sId.toString() === unauthorizedSessionId.toString() &&
          uId.toString() === unauthorizedUserId.toString()
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

    mockUserRepo.findById.mockImplementation((uId) => {
      if (uId.toString() === employeeUserId.toString()) {
        return Promise.resolve({
          _id: employeeUserId,
          status: UserStatus.ACTIVE,
          roleIds: [employeeRoleId],
        } as unknown as UserLean);
      }
      if (uId.toString() === unauthorizedUserId.toString()) {
        return Promise.resolve({
          _id: unauthorizedUserId,
          status: UserStatus.ACTIVE,
          roleIds: [unauthorizedRoleId],
        } as unknown as UserLean);
      }
      return Promise.resolve(null);
    });

    mockAuthorizationService.hasPermissions.mockImplementation(
      (roleIds: Types.ObjectId[], perms: string[]) => {
        const allowed: string[] = [
          PermissionKeys.LEAVE_REQUESTS_APPLY,
          PermissionKeys.LEAVE_REQUESTS_VIEW_OWN,
          PermissionKeys.LEAVES_CREATE,
          PermissionKeys.LEAVES_VIEW,
        ];
        if (
          roleIds.some((r) => r.toString() === employeeRoleId.toString()) &&
          perms.every((p) => allowed.includes(p))
        ) {
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      },
    );
  });

  // ===========================================================================
  // TEST 1 — Valid Full-Day Leave Application Crossing Calendar Years
  // ===========================================================================
  describe('Test 1 — Valid full-day leave application crossing calendar years', () => {
    it('should successfully apply for full-day leave crossing 2026-2027 and reserve balances atomically', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({
        allowHalfDay: true,
        deductWeekends: false,
        deductHolidays: false,
      });

      // Public Holiday on 2027-01-01 (New Year's Day)
      holidaysStore.push({
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
      });

      // Seed 2026 balance: 10 days available; Seed 2027 balance: 10 days available
      seedBalance(emp._id, lt._id, 2026, 10);
      seedBalance(emp._id, lt._id, 2027, 10);

      // Clean full-day payload (halfDaySession omitted as required for isHalfDay: false)
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2027-01-04',
        isHalfDay: false,
        reason: 'Attending family wedding and travel.',
        attachmentUrl:
          'https://storage.enterprise.com/docs/medical_cert_01.pdf',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(response.data.status).toBe(LeaveRequestStatus.PENDING);
      expect(response.data.startDate).toBe('2026-12-28');
      expect(response.data.endDate).toBe('2027-01-04');
      expect(response.data.isHalfDay).toBe(false);
      expect(response.data.halfDaySession).toBeNull();

      // Calculation breakdown:
      // 2026: Dec 28 (Mon), 29 (Tue), 30 (Wed), 31 (Thu) = 4 days
      // 2027: Jan 01 (Holiday, excluded), Jan 02 (Sat, working), Jan 03 (Sun, weekend excluded), Jan 04 (Mon, working) = 2 days
      // Total days = 6 days
      expect(response.data.totalDays).toBe(6);
      expect(response.data.yearBreakdown).toEqual([
        { year: 2026, days: 4 },
        { year: 2027, days: 2 },
      ]);

      // Database Verifications:
      // 1. LeaveRequest document exists in store
      expect(leaveRequestsStore.size).toBe(1);
      const savedRequest = Array.from(leaveRequestsStore.values())[0];
      expect(savedRequest.employeeId.toString()).toBe(emp._id.toString());
      expect(savedRequest.leaveTypeId.toString()).toBe(lt._id.toString());
      expect(savedRequest.totalDays).toBe(6);

      // 2. Year 2026 balance reserved 4 days (pending: 4, available: 6)
      const balance2026 = leaveBalancesStore.get(
        balanceKey(emp._id, lt._id, 2026),
      );
      expect(balance2026?.pendingDays).toBe(4);
      expect(balance2026?.availableBalance).toBe(6);

      // 3. Year 2027 balance reserved 2 days (pending: 2, available: 8)
      const balance2027 = leaveBalancesStore.get(
        balanceKey(emp._id, lt._id, 2027),
      );
      expect(balance2027?.pendingDays).toBe(2);
      expect(balance2027?.availableBalance).toBe(8);

      // 4. Double-entry ledger audit: exactly two RESERVATION transactions
      expect(leaveTransactionsStore).toHaveLength(2);
      const createdRequestId = new Types.ObjectId(response.data.id);
      expect(leaveTransactionsStore[0]).toMatchObject({
        employeeId: emp._id,
        leaveTypeId: lt._id,
        year: 2026,
        transactionType: LeaveTransactionType.RESERVATION,
        days: -4,
        newAvailable: 6,
        referenceId: createdRequestId,
        referenceType: 'LeaveRequest',
      });
      expect(leaveTransactionsStore[1]).toMatchObject({
        employeeId: emp._id,
        leaveTypeId: lt._id,
        year: 2027,
        transactionType: LeaveTransactionType.RESERVATION,
        days: -2,
        newAvailable: 8,
        referenceId: createdRequestId,
        referenceType: 'LeaveRequest',
      });

      // Assert that both cross-year transactions link to the exact same LeaveRequest _id
      expect(leaveTransactionsStore[0].referenceId?.toString()).toBe(
        response.data.id,
      );
      expect(leaveTransactionsStore[1].referenceId?.toString()).toBe(
        response.data.id,
      );
    });
  });

  // ===========================================================================
  // TEST 2 — Insufficient Leave Balance
  // ===========================================================================
  describe('Test 2 — Insufficient leave balance', () => {
    it('should reject application with 400 Bad Request when available balance is less than required', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({ allowNegativeBalance: false });

      // Employee has 2 available days in 2026
      seedBalance(emp._id, lt._id, 2026, 2);

      // Requests 5 working days: Mon 2026-06-01 to Fri 2026-06-05
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        isHalfDay: false,
        reason: 'Extended vacation exceeding available balance',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Insufficient leave balance for year 2026. Requested: 5 days',
          HttpStatus.BAD_REQUEST,
        ),
      );

      // Verify no leave request created, zero ledger writes, zero balance mutations
      expect(leaveRequestsStore.size).toBe(0);
      expect(leaveTransactionsStore).toHaveLength(0);
      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.availableBalance).toBe(2);
      expect(balance?.pendingDays).toBe(0);
    });
  });

  // ===========================================================================
  // TEST 3 — Invalid Date Range Chronology
  // ===========================================================================
  describe('Test 3 — Invalid date range', () => {
    it('should reject with 400 Bad Request when startDate is after endDate', async () => {
      createEmployee();
      const lt = createLeaveType();

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2027-01-05',
        endDate: '2027-01-04',
        isHalfDay: false,
        reason: 'Invalid chronological range test',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'startDate cannot be after endDate',
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveRequestsStore.size).toBe(0);
    });
  });

  // ===========================================================================
  // TEST 4 — Half-Day Leave Validation & Strict Payload Matrix
  // ===========================================================================
  describe('Test 4 — Half-day leave', () => {
    it('4a: should successfully apply for half-day with FIRST_HALF and duration = 0.5', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({ allowHalfDay: true });
      seedBalance(emp._id, lt._id, 2026, 5);

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
        reason: 'Personal morning doctor visit.',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      expect(response.data.totalDays).toBe(0.5);
      expect(response.data.isHalfDay).toBe(true);
      expect(response.data.halfDaySession).toBe(HalfDaySession.FIRST_HALF);

      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(0.5);
      expect(balance?.availableBalance).toBe(4.5);
    });

    it('4b: should successfully apply for half-day with SECOND_HALF and duration = 0.5', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({ allowHalfDay: true });
      seedBalance(emp._id, lt._id, 2026, 5);

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: true,
        halfDaySession: HalfDaySession.SECOND_HALF,
        reason: 'Personal afternoon errand.',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      expect(response.data.totalDays).toBe(0.5);
      expect(response.data.isHalfDay).toBe(true);
      expect(response.data.halfDaySession).toBe(HalfDaySession.SECOND_HALF);
    });

    it('4c: should reject when isHalfDay is false and halfDaySession is provided (Swagger conflict guard)', async () => {
      createEmployee();
      const lt = createLeaveType();

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: false,
        halfDaySession: HalfDaySession.FIRST_HALF,
        reason: 'Conflicting payload test',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'halfDaySession must not be provided when isHalfDay is false',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('4d: should reject when isHalfDay is true and halfDaySession is omitted or null', async () => {
      createEmployee();
      const lt = createLeaveType();

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: true,
        reason: 'Half-day missing session test',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Half-day session is required for half-day leave',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('4e: should reject when isHalfDay is true on a multi-day date range', async () => {
      createEmployee();
      const lt = createLeaveType({ allowHalfDay: true });

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-29',
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
        reason: 'Multi-day half day invalid attempt',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Half-day leave must start and end on the exact same date',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('4f: should reject half-day application when Leave Type disables allowHalfDay', async () => {
      createEmployee();
      const lt = createLeaveType({ allowHalfDay: false });

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: true,
        halfDaySession: HalfDaySession.FIRST_HALF,
        reason: 'Half-day on restricted leave type',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Half-day leave is not permitted for this leave type',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });
  });

  // ===========================================================================
  // TEST 5 — Overlapping Leave Request Protection
  // ===========================================================================
  describe('Test 5 — Overlapping leave request', () => {
    it('should reject with 409 Conflict when existing pending/approved request overlaps date range', async () => {
      const emp = createEmployee();
      const lt = createLeaveType();
      seedBalance(emp._id, lt._id, 2026, 10);

      // Seed an existing PENDING request: 2026-06-15 to 2026-06-18
      const existingId = new Types.ObjectId();
      leaveRequestsStore.set(existingId.toString(), {
        _id: existingId,
        employeeId: emp._id,
        leaveTypeId: lt._id,
        startDate: '2026-06-15',
        endDate: '2026-06-18',
        totalDays: 4,
        status: LeaveRequestStatus.PENDING,
      } as unknown as LeaveRequestLean);

      // Try applying for overlapping range: 2026-06-17 to 2026-06-20
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-06-17',
        endDate: '2026-06-20',
        isHalfDay: false,
        reason: 'Overlapping leave application test',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'You already have a pending or approved leave request overlapping dates 2026-06-17 to 2026-06-20',
          HttpStatus.CONFLICT,
        ),
      );

      // Verify no second request created
      expect(leaveRequestsStore.size).toBe(1);
    });
  });

  // ===========================================================================
  // TEST 6 — Holiday & Weekend Calculation Exclusions (All 4 Combinations & Multi-Year)
  // ===========================================================================
  describe('Test 6 — Holiday and weekend calculation', () => {
    it('6a (false, false): should exclude configured holidays and weekly offs', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({
        deductWeekends: false,
        deductHolidays: false,
      });
      seedBalance(emp._id, lt._id, 2026, 10);

      // Friday 2026-12-25 is configured holiday
      holidaysStore.push({
        _id: new Types.ObjectId(),
        name: 'Christmas Holiday',
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

      // Sunday 2026-12-27 is configured weekly off
      weeklyOffsStore.add('2026-12-27');

      // Span: Fri 2026-12-25 to Tue 2026-12-29 (5 calendar days)
      // Dec 25 (Fri) = Holiday (excluded)
      // Dec 26 (Sat) = Working day (included: 1.0)
      // Dec 27 (Sun) = Configured weekly off (excluded)
      // Dec 28 (Mon) = Working day (included: 1.0)
      // Dec 29 (Tue) = Working day (included: 1.0)
      // Total deductible days = 3.0 days
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-25',
        endDate: '2026-12-29',
        isHalfDay: false,
        reason: 'Personal holiday and weekend exclusion test.',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      expect(response.data.totalDays).toBe(3);
      const savedDocA = leaveRequestsStore.get(response.data.id);
      expect(savedDocA?.excludedDates).toEqual(
        expect.arrayContaining(['2026-12-25', '2026-12-27']),
      );

      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(3);
      expect(balance?.availableBalance).toBe(7);
    });

    it('6b (true, false): should deduct configured weekly offs but exclude holidays', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({
        deductWeekends: true,
        deductHolidays: false,
      });
      seedBalance(emp._id, lt._id, 2026, 10);

      holidaysStore.push({
        _id: new Types.ObjectId(),
        name: 'Christmas Holiday',
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
      weeklyOffsStore.add('2026-12-27');

      // Dec 25 (Fri) = Holiday (excluded)
      // Dec 26, 27 (weekly off deducted!), 28, 29 = 4 deductible days
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-25',
        endDate: '2026-12-29',
        isHalfDay: false,
        reason: 'Deduct weekend but exclude holiday.',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      expect(response.data.totalDays).toBe(4);
      const savedDocB = leaveRequestsStore.get(response.data.id);
      expect(savedDocB?.excludedDates).toEqual(['2026-12-25']);

      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(4);
      expect(balance?.availableBalance).toBe(6);
    });

    it('6c (false, true): should exclude configured weekly offs but deduct holidays', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({
        deductWeekends: false,
        deductHolidays: true,
      });
      seedBalance(emp._id, lt._id, 2026, 10);

      holidaysStore.push({
        _id: new Types.ObjectId(),
        name: 'Christmas Holiday',
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
      weeklyOffsStore.add('2026-12-27');

      // Dec 25 (Fri) = Holiday (deducted!)
      // Dec 27 (Sun) = Weekly off (excluded!)
      // Dec 25, 26, 28, 29 = 4 deductible days
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-25',
        endDate: '2026-12-29',
        isHalfDay: false,
        reason: 'Exclude weekend but deduct holiday.',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      expect(response.data.totalDays).toBe(4);
      const savedDocC = leaveRequestsStore.get(response.data.id);
      expect(savedDocC?.excludedDates).toEqual(['2026-12-27']);

      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(4);
      expect(balance?.availableBalance).toBe(6);
    });

    it('6d (true, true): should deduct both configured weekly offs and holidays', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({
        deductWeekends: true,
        deductHolidays: true,
      });
      seedBalance(emp._id, lt._id, 2026, 10);

      holidaysStore.push({
        _id: new Types.ObjectId(),
        name: 'Christmas Holiday',
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
      weeklyOffsStore.add('2026-12-27');

      // All 5 calendar days deducted
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-25',
        endDate: '2026-12-29',
        isHalfDay: false,
        reason: 'Deduct both weekend and holiday.',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      expect(response.data.totalDays).toBe(5);
      const savedDocD = leaveRequestsStore.get(response.data.id);
      expect(savedDocD?.excludedDates).toHaveLength(0);

      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(5);
      expect(balance?.availableBalance).toBe(5);
    });

    it('6d-2 (overlap): should handle coinciding weekly off and holiday on the same date without double deduction or duplicate exclusions', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({
        deductWeekends: false,
        deductHolidays: false,
      });
      seedBalance(emp._id, lt._id, 2026, 10);

      // Sunday 2026-10-25 is a configured weekly off AND a public holiday
      weeklyOffsStore.add('2026-10-24'); // Sat
      weeklyOffsStore.add('2026-10-25'); // Sun
      holidaysStore.push({
        _id: new Types.ObjectId(),
        name: 'Dussehra Holiday',
        date: '2026-10-25',
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

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-10-23', // Fri
        endDate: '2026-10-26', // Mon
        isHalfDay: false,
        reason: 'Coinciding weekend and holiday leave application',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      // Deducts Fri 23 & Mon 26 = 2 days
      expect(response.data.totalDays).toBe(2);

      const savedDoc = leaveRequestsStore.get(response.data.id);
      expect(savedDoc?.excludedDates).toEqual(['2026-10-24', '2026-10-25']);
      // Verify no duplicate string of '2026-10-25' in excludedDates
      expect(
        savedDoc?.excludedDates?.filter((d: string) => d === '2026-10-25'),
      ).toHaveLength(1);

      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(2);
      expect(balance?.availableBalance).toBe(8);
    });

    it('6e-1: Multi-Year Crossover (false, false) with balance reservations across 2026-2027', async () => {
      holidaysStore.push({
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
      });
      weeklyOffsStore.add('2027-01-02');
      weeklyOffsStore.add('2027-01-03');

      const emp = createEmployee();
      const lt = createLeaveType({
        deductWeekends: false,
        deductHolidays: false,
      });
      seedBalance(emp._id, lt._id, 2026, 10);
      seedBalance(emp._id, lt._id, 2027, 10);

      const res = await executeApplyLeaveApi({
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-30',
        endDate: '2027-01-04',
        reason: 'Multi-year false/false',
      });
      expect(res.success).toBe(true);
      expect(res.data.totalDays).toBe(3); // 2 in 2026, 1 in 2027
      expect(res.data.yearBreakdown).toEqual([
        { year: 2026, days: 2 },
        { year: 2027, days: 1 },
      ]);
      const bal2026 = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(bal2026?.pendingDays).toBe(2);
      expect(bal2026?.availableBalance).toBe(8);
      const bal2027 = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2027));
      expect(bal2027?.pendingDays).toBe(1);
      expect(bal2027?.availableBalance).toBe(9);
    });

    it('6e-2: Multi-Year Crossover (true, false) with balance reservations across 2026-2027', async () => {
      holidaysStore.push({
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
      });
      weeklyOffsStore.add('2027-01-02');
      weeklyOffsStore.add('2027-01-03');

      const emp = createEmployee();
      const lt = createLeaveType({
        deductWeekends: true,
        deductHolidays: false,
      });
      seedBalance(emp._id, lt._id, 2026, 10);
      seedBalance(emp._id, lt._id, 2027, 10);

      const res = await executeApplyLeaveApi({
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-30',
        endDate: '2027-01-04',
        reason: 'Multi-year true/false',
      });
      expect(res.success).toBe(true);
      expect(res.data.totalDays).toBe(5); // 2 in 2026, 3 in 2027 (Sat+Sun weekly offs deducted)
      expect(res.data.yearBreakdown).toEqual([
        { year: 2026, days: 2 },
        { year: 2027, days: 3 },
      ]);
      const bal2026 = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(bal2026?.pendingDays).toBe(2);
      expect(bal2026?.availableBalance).toBe(8);
      const bal2027 = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2027));
      expect(bal2027?.pendingDays).toBe(3);
      expect(bal2027?.availableBalance).toBe(7);
    });

    it('6e-3: Multi-Year Crossover (false, true) with balance reservations across 2026-2027', async () => {
      holidaysStore.push({
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
      });
      weeklyOffsStore.add('2027-01-02');
      weeklyOffsStore.add('2027-01-03');

      const emp = createEmployee();
      const lt = createLeaveType({
        deductWeekends: false,
        deductHolidays: true,
      });
      seedBalance(emp._id, lt._id, 2026, 10);
      seedBalance(emp._id, lt._id, 2027, 10);

      const res = await executeApplyLeaveApi({
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-30',
        endDate: '2027-01-04',
        reason: 'Multi-year false/true',
      });
      expect(res.success).toBe(true);
      expect(res.data.totalDays).toBe(4); // 2 in 2026, 2 in 2027 (Holiday deducted, Sat+Sun excluded)
      expect(res.data.yearBreakdown).toEqual([
        { year: 2026, days: 2 },
        { year: 2027, days: 2 },
      ]);
      const bal2026 = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(bal2026?.pendingDays).toBe(2);
      expect(bal2026?.availableBalance).toBe(8);
      const bal2027 = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2027));
      expect(bal2027?.pendingDays).toBe(2);
      expect(bal2027?.availableBalance).toBe(8);
    });

    it('6e-4: Multi-Year Crossover (true, true) with balance reservations across 2026-2027', async () => {
      holidaysStore.push({
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
      });
      weeklyOffsStore.add('2027-01-02');
      weeklyOffsStore.add('2027-01-03');

      const emp = createEmployee();
      const lt = createLeaveType({
        deductWeekends: true,
        deductHolidays: true,
      });
      seedBalance(emp._id, lt._id, 2026, 10);
      seedBalance(emp._id, lt._id, 2027, 10);

      const res = await executeApplyLeaveApi({
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-30',
        endDate: '2027-01-04',
        reason: 'Multi-year true/true',
      });
      expect(res.success).toBe(true);
      expect(res.data.totalDays).toBe(6); // All 6 calendar days deducted (2 in 2026, 4 in 2027)
      expect(res.data.yearBreakdown).toEqual([
        { year: 2026, days: 2 },
        { year: 2027, days: 4 },
      ]);
      const bal2026 = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(bal2026?.pendingDays).toBe(2);
      expect(bal2026?.availableBalance).toBe(8);
      const bal2027 = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2027));
      expect(bal2027?.pendingDays).toBe(4);
      expect(bal2027?.availableBalance).toBe(6);
    });

    it('6f: should dynamically respect arbitrary configured weekly off (e.g. Wednesday weekly off) without hardcoding', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({
        deductWeekends: false,
        deductHolidays: false,
      });
      seedBalance(emp._id, lt._id, 2026, 10);

      // Configure Wednesday 2026-10-14 as the dynamic weekly off
      weeklyOffsStore.add('2026-10-14');

      // Span: Tue 2026-10-13 to Thu 2026-10-15 (3 calendar days)
      // Oct 13 (Tue): Working
      // Oct 14 (Wed): Configured weekly off (excluded!)
      // Oct 15 (Thu): Working
      // Total deductible days = 2.0 days
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-10-13',
        endDate: '2026-10-15',
        isHalfDay: false,
        reason: 'Mid-week leave with Wednesday off',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      expect(response.data.totalDays).toBe(2);
      const savedDocF = leaveRequestsStore.get(response.data.id);
      expect(savedDocF?.excludedDates).toEqual(['2026-10-14']);

      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(2);
      expect(balance?.availableBalance).toBe(8);
    });
  });

  // ===========================================================================
  // TEST 7 — Mandatory Supporting Document / Attachment Policy
  // ===========================================================================
  describe('Test 7 — Leave Type requires attachment', () => {
    it('7a: should reject with 400 when requiresAttachment is true and attachmentUrl is missing', async () => {
      createEmployee();
      const lt = createLeaveType({
        name: 'Sick Leave',
        requiresAttachment: true,
      });

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: false,
        reason: 'Medical consultation without required certificate',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Supporting attachment is required for 'Sick Leave'",
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveRequestsStore.size).toBe(0);
    });

    it('7b: should accept when requiresAttachment is true and valid attachmentUrl is provided', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({
        name: 'Sick Leave',
        requiresAttachment: true,
      });
      seedBalance(emp._id, lt._id, 2026, 5);

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: false,
        reason: 'Medical consultation with certificate',
        attachmentUrl:
          'https://storage.enterprise.com/docs/medical_cert_01.pdf',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      expect(response.data.attachmentUrl).toBe(
        'https://storage.enterprise.com/docs/medical_cert_01.pdf',
      );
      expect(leaveRequestsStore.size).toBe(1);
    });
  });

  // ===========================================================================
  // TEST 8 — Employment Status Eligibility
  // ===========================================================================
  describe('Test 8 — Employee employment status eligibility', () => {
    it('8a: should reject application with 403 Forbidden for TERMINATED employee', async () => {
      createEmployee({ employmentStatus: EmploymentStatus.TERMINATED });
      const lt = createLeaveType();

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: false,
        reason: 'Attempted leave by terminated staff',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          "Employees with status 'terminated' cannot apply for leave",
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('8b: should reject application with 403 Forbidden for RESIGNED employee', async () => {
      createEmployee({ employmentStatus: EmploymentStatus.RESIGNED });
      const lt = createLeaveType();

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: false,
        reason: 'Attempted leave by resigned staff',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          "Employees with status 'resigned' cannot apply for leave",
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('8c: should reject probation employee when leave type excludes PROBATION status', async () => {
      createEmployee({ employmentStatus: EmploymentStatus.PROBATION });
      const lt = createLeaveType({
        applicableEmploymentStatuses: [EmploymentStatus.ACTIVE],
      });

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: false,
        reason: 'Attempted leave during probation',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          `Employees on 'probation' are not eligible for '${lt.name}'`,
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('8d: should reject notice period employee when allowDuringNoticePeriod is false', async () => {
      createEmployee({ employmentStatus: EmploymentStatus.NOTICE_PERIOD });
      const lt = createLeaveType({
        applicableEmploymentStatuses: [
          EmploymentStatus.ACTIVE,
          EmploymentStatus.NOTICE_PERIOD,
        ],
        allowDuringNoticePeriod: false,
      });

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: false,
        reason: 'Attempted leave while serving notice period',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          `'${lt.name}' cannot be taken during notice period per company policy`,
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('8e: should allow notice period employee when allowDuringNoticePeriod is true', async () => {
      const emp = createEmployee({
        employmentStatus: EmploymentStatus.NOTICE_PERIOD,
      });
      const lt = createLeaveType({
        applicableEmploymentStatuses: [
          EmploymentStatus.ACTIVE,
          EmploymentStatus.PROBATION,
        ],
        allowDuringNoticePeriod: true,
      });
      seedBalance(emp._id, lt._id, 2026, 10);

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: false,
        reason: 'Permitted leave while serving notice period',
      };

      const result = await executeApplyLeaveApi(payload);
      expect(result.success).toBe(true);
      expect(result.data.status).toBe(LeaveRequestStatus.PENDING);
    });
  });

  // ===========================================================================
  // TEST 9 — Authentication & RBAC Authorization
  // ===========================================================================
  describe('Test 9 — Unauthorized access', () => {
    it('9a: should reject with 401 Unauthorized when no authentication token is provided', async () => {
      const payload = {
        leaveTypeId: new Types.ObjectId().toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: false,
        reason: 'Unauthenticated apply attempt',
      };

      const ctx = createMockContext(undefined, payload);
      reflector.getAllAndOverride.mockReturnValue(false);

      await expect(jwtAuthGuard.canActivate(ctx)).rejects.toThrow(
        new AppError(
          ErrorCode.UNAUTHORIZED,
          'Invalid or expired access token',
          HttpStatus.UNAUTHORIZED,
        ),
      );
    });

    it('9b: should reject with 403 Forbidden when authenticated user lacks leaves:create permission', async () => {
      const payload = {
        leaveTypeId: new Types.ObjectId().toString(),
        startDate: '2026-12-28',
        endDate: '2026-12-28',
        isHalfDay: false,
        reason: 'Unauthorized user apply attempt',
      };

      const ctx = createMockContext(unauthorizedToken, payload);
      reflector.getAllAndOverride.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      reflector.getAllAndOverride.mockReturnValue([
        PermissionKeys.LEAVE_REQUESTS_APPLY,
      ]);
      await expect(permissionsGuard.canActivate(ctx)).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          `Insufficient permission. Required: ${PermissionKeys.LEAVE_REQUESTS_APPLY}`,
          HttpStatus.FORBIDDEN,
        ),
      );
    });
  });

  // ===========================================================================
  // TEST 10 — Duplicate Submission & Idempotent Overlap Guard
  // ===========================================================================
  describe('Test 10 — Duplicate submission protection', () => {
    it('should serialize concurrent duplicate requests on employee aggregate root and reject duplicate with 409', async () => {
      const emp = createEmployee();
      const lt = createLeaveType();
      seedBalance(emp._id, lt._id, 2026, 10);

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        isHalfDay: false,
        reason: 'Conference attendance and travel.',
      };

      // 1. First execution succeeds
      const firstResponse = await executeApplyLeaveApi(payload);
      expect(firstResponse.success).toBe(true);
      expect(firstResponse.data.totalDays).toBe(3);
      expect(leaveRequestsStore.size).toBe(1);

      // 2. Immediate duplicate retry fails with 409 Conflict
      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'You already have a pending or approved leave request overlapping dates 2026-11-10 to 2026-11-12',
          HttpStatus.CONFLICT,
        ),
      );

      // 3. Verify no duplicate document or duplicate balance reservation
      expect(leaveRequestsStore.size).toBe(1);
      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(3);
      expect(balance?.availableBalance).toBe(7);
      expect(leaveTransactionsStore).toHaveLength(1);
    });

    it('should safely handle simultaneous parallel submissions with Promise.allSettled', async () => {
      const emp = createEmployee();
      const lt = createLeaveType();
      seedBalance(emp._id, lt._id, 2026, 10);

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-11-16',
        endDate: '2026-11-18',
        isHalfDay: false,
        reason: 'Concurrent race condition test.',
      };

      // Execute both requests concurrently
      const results = await Promise.allSettled([
        executeApplyLeaveApi(payload),
        executeApplyLeaveApi(payload),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Exactly 1 request saved, exactly 3 days reserved, exactly 1 transaction
      expect(leaveRequestsStore.size).toBe(1);
      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(3);
      expect(balance?.availableBalance).toBe(7);
      expect(leaveTransactionsStore).toHaveLength(1);
    });
  });

  // ===========================================================================
  // TEST 11 — Negative Balance Allowance Policy
  // ===========================================================================
  describe('Test 11 — Negative balance policy', () => {
    it('should permit application exceeding available balance when allowNegativeBalance is true', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({ allowNegativeBalance: true });
      seedBalance(emp._id, lt._id, 2026, 2); // Only 2 available

      // Requests 5 working days: Mon 2026-06-01 to Fri 2026-06-05
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        isHalfDay: false,
        reason: 'Medical treatment requiring advance leave',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      expect(response.data.totalDays).toBe(5);

      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(5);
      expect(balance?.availableBalance).toBe(-3); // Drops to -3 as allowed by policy
      expect(leaveTransactionsStore).toHaveLength(1);
    });
  });

  // ===========================================================================
  // TEST 12 — Max Consecutive Days Policy Guard
  // ===========================================================================
  describe('Test 12 — Max consecutive days limit', () => {
    it('12a: should reject application when duration exceeds maxConsecutiveDays', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({ maxConsecutiveDays: 5 });
      seedBalance(emp._id, lt._id, 2026, 20);

      // Mon 2026-06-01 to Sat 2026-06-06 = 6 working days
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-06-01',
        endDate: '2026-06-06',
        isHalfDay: false,
        reason: 'Extended leave exceeding consecutive limit',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Leave duration (6 days) exceeds maximum consecutive limit of 5 days',
          HttpStatus.BAD_REQUEST,
        ),
      );

      // Verify zero mutations
      expect(leaveRequestsStore.size).toBe(0);
      expect(leaveTransactionsStore).toHaveLength(0);
      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(0);
      expect(balance?.availableBalance).toBe(20);
    });

    it('12b: should allow Friday-Monday leave when maxConsecutiveDays is 3 and deductWeekends is false (2 days count)', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({
        maxConsecutiveDays: 3,
        deductWeekends: false,
        deductHolidays: false,
      });
      seedBalance(emp._id, lt._id, 2026, 10);

      // Fri 2026-10-09 to Mon 2026-10-12
      // Sat Oct 10 & Sun Oct 11 are configured weekly offs
      weeklyOffsStore.add('2026-10-10');
      weeklyOffsStore.add('2026-10-11');

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-10-09',
        endDate: '2026-10-12',
        isHalfDay: false,
        reason: 'Friday to Monday with weekends excluded',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      expect(response.data.totalDays).toBe(2); // Only Fri and Mon count toward the limit (2 <= 3)
      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(2);
      expect(balance?.availableBalance).toBe(8);
    });

    it('12c: should reject Friday-Monday leave when maxConsecutiveDays is 3 and deductWeekends is true (4 days count > 3)', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({
        maxConsecutiveDays: 3,
        deductWeekends: true,
        deductHolidays: false,
      });
      seedBalance(emp._id, lt._id, 2026, 10);

      weeklyOffsStore.add('2026-10-10');
      weeklyOffsStore.add('2026-10-11');

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-10-09',
        endDate: '2026-10-12',
        isHalfDay: false,
        reason: 'Friday to Monday with weekends deducted',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Leave duration (4 days) exceeds maximum consecutive limit of 3 days',
          HttpStatus.BAD_REQUEST,
        ),
      );

      // Verify zero mutations
      expect(leaveRequestsStore.size).toBe(0);
      const balance = leaveBalancesStore.get(balanceKey(emp._id, lt._id, 2026));
      expect(balance?.pendingDays).toBe(0);
      expect(balance?.availableBalance).toBe(10);
    });
  });

  // ===========================================================================
  // TEST 13 — Joining Date Policy Guard
  // ===========================================================================
  describe('Test 13 — Joining date guard', () => {
    it('should reject leave application prior to employee date of joining', async () => {
      createEmployee({ dateOfJoining: new Date('2026-06-01') });
      const lt = createLeaveType();

      // Requests leave starting before joining date
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-05-20',
        endDate: '2026-05-22',
        isHalfDay: false,
        reason: 'Pre-joining leave attempt',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Cannot apply for leave prior to date of joining (2026-06-01)',
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveRequestsStore.size).toBe(0);
    });
  });

  // ===========================================================================
  // TEST 14 — Inactive Leave Type Guard
  // ===========================================================================
  describe('Test 14 — Inactive leave type guard', () => {
    it('should reject application when leave type is inactive', async () => {
      createEmployee();
      const lt = createLeaveType({
        name: 'Sabbatical Leave',
        isActive: false,
      });

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        isHalfDay: false,
        reason: 'Attempt on inactive leave type',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Leave type 'Sabbatical Leave' is currently inactive",
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveRequestsStore.size).toBe(0);
    });
  });

  // ===========================================================================
  // TEST 15 — Zero Working Days Selection Guard
  // ===========================================================================
  describe('Test 15 — Zero working days guard', () => {
    it('should reject application when selected range contains only weekends or holidays', async () => {
      createEmployee();
      const lt = createLeaveType({ deductWeekends: false });

      // 2026-10-25 is Sunday
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-10-25',
        endDate: '2026-10-25',
        isHalfDay: false,
        reason: 'Sunday leave attempt',
      };

      await expect(executeApplyLeaveApi(payload)).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Selected date range contains only weekends or holidays with zero deductible working days',
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(leaveRequestsStore.size).toBe(0);
    });
  });

  // ===========================================================================
  // TEST 16 — Leave Reservation Ledger Reference Linking
  // ===========================================================================
  describe('Test 16 — Leave Reservation Ledger Reference Linking', () => {
    it('16a: should ensure single-year leave application links RESERVATION ledger entry referenceId to LeaveRequest._id', async () => {
      const emp = createEmployee();
      const lt = createLeaveType();
      seedBalance(emp._id, lt._id, 2026, 10);

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-06-08',
        endDate: '2026-06-10',
        isHalfDay: false,
        reason: '3 days annual vacation',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      const requestId = response.data.id;
      expect(requestId).toBeDefined();

      // Verify the persisted LeaveRequest has the same ID
      const persistedReq = leaveRequestsStore.get(requestId);
      expect(persistedReq).toBeDefined();
      expect(persistedReq?._id.toString()).toBe(requestId);

      // Verify the ledger transaction
      const tx = leaveTransactionsStore.find(
        (t) =>
          t.transactionType === LeaveTransactionType.RESERVATION &&
          t.referenceId?.toString() === requestId,
      );
      expect(tx).toBeDefined();
      expect(tx?.referenceId).toBeInstanceOf(Types.ObjectId);
      expect(tx?.referenceId?.toString()).toBe(requestId);
      expect(tx?.referenceType).toBe('LeaveRequest');
      expect(tx?.days).toBe(-3);
      expect(tx?.year).toBe(2026);
    });

    it('16b: should ensure all cross-year reservation entries reference the exact same LeaveRequest._id', async () => {
      const emp = createEmployee();
      const lt = createLeaveType({
        deductWeekends: false,
        deductHolidays: false,
      });
      seedBalance(emp._id, lt._id, 2026, 10);
      seedBalance(emp._id, lt._id, 2027, 10);

      // Mon 2026-12-28 to Fri 2027-01-01 (4 days in 2026, 1 day in 2027)
      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-12-28',
        endDate: '2027-01-01',
        isHalfDay: false,
        reason: 'Cross-year year-end break',
      };

      const response = await executeApplyLeaveApi(payload);

      expect(response.success).toBe(true);
      const requestId = response.data.id;

      const crossYearTxs = leaveTransactionsStore.filter(
        (t) =>
          t.transactionType === LeaveTransactionType.RESERVATION &&
          t.referenceId?.toString() === requestId,
      );

      expect(crossYearTxs).toHaveLength(2);

      const tx2026 = crossYearTxs.find((t) => t.year === 2026);
      const tx2027 = crossYearTxs.find((t) => t.year === 2027);

      expect(tx2026).toBeDefined();
      expect(tx2027).toBeDefined();

      expect(tx2026?.referenceId?.toString()).toBe(requestId);
      expect(tx2027?.referenceId?.toString()).toBe(requestId);
      expect(tx2026?.referenceType).toBe('LeaveRequest');
      expect(tx2027?.referenceType).toBe('LeaveRequest');

      // Verify identical ObjectId reference
      expect(
        tx2026?.referenceId?.equals(tx2027?.referenceId as Types.ObjectId),
      ).toBe(true);
    });

    it('16c: should allow retrieving reservation ledger transactions using referenceId via findByReference and findList', async () => {
      const emp = createEmployee();
      const lt = createLeaveType();
      seedBalance(emp._id, lt._id, 2026, 10);

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-07-06',
        endDate: '2026-07-07',
        isHalfDay: false,
        reason: 'Mid-year check',
      };

      const response = await executeApplyLeaveApi(payload);
      const requestId = response.data.id;

      // Query by reference and type
      const singleTx = await mockLeaveTransactionRepo.findByReference(
        requestId,
        LeaveTransactionType.RESERVATION,
      );
      expect(singleTx).not.toBeNull();
      expect(singleTx?.referenceId?.toString()).toBe(requestId);
      expect(singleTx?.transactionType).toBe(LeaveTransactionType.RESERVATION);

      // Query list by referenceId
      const listResult = await mockLeaveTransactionRepo.findList({
        referenceId: new Types.ObjectId(requestId),
      });
      expect(listResult.data).toHaveLength(1);
      expect(listResult.data[0].referenceId?.toString()).toBe(requestId);
    });

    it('16d: should guarantee no reservation entry is ever committed with referenceId: null', async () => {
      const emp = createEmployee();
      const lt = createLeaveType();
      seedBalance(emp._id, lt._id, 2026, 10);

      const payload = {
        leaveTypeId: lt._id.toString(),
        startDate: '2026-08-03',
        endDate: '2026-08-05',
        isHalfDay: false,
        reason: 'Strict referenceId check',
      };

      await executeApplyLeaveApi(payload);

      const allReservations = leaveTransactionsStore.filter(
        (t) => t.transactionType === LeaveTransactionType.RESERVATION,
      );

      expect(allReservations.length).toBeGreaterThan(0);
      for (const resTx of allReservations) {
        expect(resTx.referenceId).not.toBeNull();
        expect(resTx.referenceId).toBeInstanceOf(Types.ObjectId);
        expect(resTx.referenceType).toBe('LeaveRequest');
      }
    });
  });

  afterAll(() => {
    employeesStore.clear();
    leaveTypesStore.clear();
    leaveBalancesStore.clear();
    leaveRequestsStore.clear();
    leaveTransactionsStore.length = 0;
    holidaysStore.length = 0;
    auditLogsStore.length = 0;
  });
});

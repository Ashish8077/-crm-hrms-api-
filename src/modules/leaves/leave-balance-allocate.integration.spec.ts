import {
  HttpStatus,
  ValidationPipe,
  ValidationError,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Connection, Types } from 'mongoose';

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
import { LeaveRequestRepository } from './repositories/leave-request.repository';
import { HolidayRepository } from './repositories/holiday.repository';
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
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  EmploymentStatus,
  EmploymentType,
} from '../employees/constants/employee.constant';
import { UserStatus } from '../users/constants/user-status.constant';
import { LeaveTransactionType } from './constants/leaves.constant';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { AllocateLeaveDto } from './dto/allocate-leave.dto';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('Leave Balance Allocation API Integration Suite (POST /api/v1/leaves/balances/allocate)', () => {
  let controller: LeavesController;
  let leavesService: LeavesService;
  let validationPipe: ValidationPipe;
  let jwtAuthGuard: JwtAuthGuard;
  let permissionsGuard: PermissionsGuard;
  let jwtService: JwtService;
  let reflector: Reflector;
  let getAllAndOverrideSpy: jest.SpyInstance;

  // Security Identities
  const JWT_SECRET = 'enterprise-hrms-allocation-integration-secret-hs256';
  const adminUserId = new Types.ObjectId();
  const adminSessionId = new Types.ObjectId();
  const adminRoleId = new Types.ObjectId();

  const unauthorizedUserId = new Types.ObjectId();
  const unauthorizedSessionId = new Types.ObjectId();
  const unauthorizedRoleId = new Types.ObjectId();

  let validAdminToken: string;
  let unauthorizedToken: string;

  // In-memory Stateful Stores for isolated, repeatable testing
  const employeesStore = new Map<string, EmployeeLean>();
  const leaveTypesStore = new Map<string, LeaveTypeLean>();
  const leaveBalancesStore = new Map<string, LeaveBalanceLean>();
  const leaveTransactionsStore: LeaveTransactionLean[] = [];
  const auditLogsStore: Array<{
    actorId: Types.ObjectId;
    action: string;
    targetModel: string;
    targetId: Types.ObjectId;
    details: Record<string, unknown>;
  }> = [];

  const balanceKey = (
    employeeId: Types.ObjectId | string,
    leaveTypeId: Types.ObjectId | string,
    year: number,
  ) => `${employeeId.toString()}_${leaveTypeId.toString()}_${year}`;

  let mockLeaveTypeRepo: jest.Mocked<LeaveTypeRepository>;
  let mockLeaveBalanceRepo: jest.Mocked<LeaveBalanceRepository>;
  let mockLeaveTransactionRepo: jest.Mocked<LeaveTransactionRepository>;
  let mockEmployeeRepo: jest.Mocked<EmployeeRepository>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;
  let mockAuthorizationService: jest.Mocked<AuthorizationService>;
  let mockSessionRepo: jest.Mocked<SessionRepository>;
  let mockUserRepo: jest.Mocked<UserRepository>;

  const createActiveEmployee = (
    overrides?: Partial<EmployeeLean>,
  ): EmployeeLean => {
    const empId = new Types.ObjectId();
    const employee: EmployeeLean = {
      _id: empId,
      userId: new Types.ObjectId(),
      employeeCode: `EMP-AL-${Date.now().toString().slice(-4)}`,
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
      name: 'Earned Leave',
      code: 'EL',
      isPaid: true,
      annualAllocation: 14,
      allowHalfDay: true,
      allowNegativeBalance: false,
      allowDuringNoticePeriod: false,
      applicableEmploymentStatuses: [
        EmploymentStatus.ACTIVE,
        EmploymentStatus.PROBATION,
      ],
      deductWeekends: false,
      deductHolidays: false,
      maxConsecutiveDays: 10,
      requiresAttachment: false,
      isCarryForwardEnabled: true,
      maxCarryForwardDays: 5,
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
   * Complete API invocation simulating the production HTTP pipeline:
   * 1. ValidationPipe: Schema transform, validate, and error map
   * 2. JwtAuthGuard: Token verification and session attachment
   * 3. PermissionsGuard: LEAVES_CREATE RBAC check
   * 4. LeavesController: Resolves actor context and delegates to LeavesService.allocateLeave
   */
  const executeAllocateApi = async (
    rawPayload: unknown,
    token: string = validAdminToken,
  ) => {
    const validatedDto = (await validationPipe.transform(rawPayload, {
      type: 'body',
      metatype: AllocateLeaveDto,
    })) as AllocateLeaveDto;

    const ctx = createMockContext(token, rawPayload);
    getAllAndOverrideSpy.mockReturnValue(false); // Route is not public
    await jwtAuthGuard.canActivate(ctx);

    getAllAndOverrideSpy.mockReturnValue([
      PermissionKeys.LEAVE_BALANCES_ALLOCATE,
    ]);
    await permissionsGuard.canActivate(ctx);

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return controller.allocateBalance(validatedDto, req);
  };

  beforeAll(() => {
    jwtService = new JwtService({ secret: JWT_SECRET });

    validAdminToken = jwtService.sign({
      sub: adminUserId.toString(),
      sid: adminSessionId.toString(),
      type: 'access',
    });

    unauthorizedToken = jwtService.sign({
      sub: unauthorizedUserId.toString(),
      sid: unauthorizedSessionId.toString(),
      type: 'access',
    });

    reflector = new Reflector();
    getAllAndOverrideSpy = jest.spyOn(reflector, 'getAllAndOverride');

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

    mockEmployeeRepo = {
      findById: jest.fn(
        (id: Types.ObjectId | string): Promise<EmployeeLean | null> => {
          const found = employeesStore.get(id.toString());
          return Promise.resolve(
            found && !found.deletedAt ? { ...found } : null,
          );
        },
      ),
    } as unknown as jest.Mocked<EmployeeRepository>;

    mockLeaveBalanceRepo = {
      findByEmployeeTypeYear: jest.fn(
        (
          employeeId: Types.ObjectId | string,
          leaveTypeId: Types.ObjectId | string,
          year: number,
        ): Promise<LeaveBalanceLean | null> => {
          const found = leaveBalancesStore.get(
            balanceKey(employeeId, leaveTypeId, year),
          );
          return Promise.resolve(
            found && !found.deletedAt ? { ...found } : null,
          );
        },
      ),
      upsertAllocation: jest.fn(
        (
          employeeId: Types.ObjectId | string,
          leaveTypeId: Types.ObjectId | string,
          year: number,
          allocatedDays: number,
          carriedForwardDays: number = 0,
          updatedBy?: Types.ObjectId | null,
        ): Promise<LeaveBalanceLean> => {
          const key = balanceKey(employeeId, leaveTypeId, year);
          const existing = leaveBalancesStore.get(key);

          if (!existing) {
            const newRecord: LeaveBalanceLean = {
              _id: new Types.ObjectId(),
              employeeId:
                typeof employeeId === 'string'
                  ? new Types.ObjectId(employeeId)
                  : employeeId,
              leaveTypeId:
                typeof leaveTypeId === 'string'
                  ? new Types.ObjectId(leaveTypeId)
                  : leaveTypeId,
              year,
              allocatedDays,
              carriedForwardDays,
              creditedDays: 0,
              debitedDays: 0,
              pendingDays: 0,
              usedDays: 0,
              availableBalance: allocatedDays + carriedForwardDays,
              deletedAt: null,
              updatedBy: updatedBy || null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            leaveBalancesStore.set(key, newRecord);
            return Promise.resolve({ ...newRecord });
          }

          const finalAllocatedDays =
            allocatedDays > 0 ? allocatedDays : existing.allocatedDays;
          const finalCarriedForwardDays =
            carriedForwardDays > 0
              ? carriedForwardDays
              : existing.carriedForwardDays;

          const newAvailable =
            finalAllocatedDays +
            finalCarriedForwardDays +
            (existing.creditedDays ?? 0) -
            ((existing.debitedDays ?? 0) +
              (existing.pendingDays ?? 0) +
              (existing.usedDays ?? 0));

          const updatedRecord: LeaveBalanceLean = {
            ...existing,
            allocatedDays: finalAllocatedDays,
            carriedForwardDays: finalCarriedForwardDays,
            availableBalance: newAvailable,
            updatedBy: updatedBy || null,
            updatedAt: new Date(),
          };
          leaveBalancesStore.set(key, updatedRecord);
          return Promise.resolve({ ...updatedRecord });
        },
      ),
    } as unknown as jest.Mocked<LeaveBalanceRepository>;

    mockLeaveTransactionRepo = {
      create: jest.fn(
        (
          data: Omit<LeaveTransactionLean, '_id' | 'createdAt'>,
        ): Promise<LeaveTransactionLean> => {
          const created: LeaveTransactionLean = {
            ...data,
            _id: new Types.ObjectId(),
            createdAt: new Date(),
          };
          leaveTransactionsStore.push(created);
          return Promise.resolve({ ...created });
        },
      ),
    } as unknown as jest.Mocked<LeaveTransactionRepository>;

    mockAuditLogsService = {
      createAuditLog: jest.fn(
        (params: {
          actorId: Types.ObjectId;
          action: string;
          targetModel: string;
          targetId: Types.ObjectId;
          details: Record<string, unknown>;
        }) => {
          auditLogsStore.push({
            actorId: params.actorId,
            action: params.action,
            targetModel: params.targetModel,
            targetId: params.targetId,
            details: params.details,
          });
          return Promise.resolve();
        },
      ),
    } as unknown as jest.Mocked<AuditLogsService>;

    mockAuthorizationService = {
      hasPermissions: jest.fn(),
      hasPermission: jest.fn(),
    } as unknown as jest.Mocked<AuthorizationService>;

    mockSessionRepo = {
      findActiveSessionByIdAndUserId: jest.fn(),
    } as unknown as jest.Mocked<SessionRepository>;

    mockUserRepo = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    const mockSession: {
      withTransaction: jest.Mock;
      endSession: jest.Mock;
    } = {
      withTransaction: jest.fn(),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    mockSession.withTransaction.mockImplementation(
      (cb: (session: unknown) => Promise<unknown>) => cb(mockSession),
    );

    const mockConnection = {
      startSession: jest.fn().mockResolvedValue(mockSession),
    } as unknown as Connection;

    leavesService = new LeavesService(
      mockLeaveTypeRepo,
      {} as unknown as HolidayRepository,
      mockLeaveBalanceRepo,
      {} as unknown as LeaveRequestRepository,
      mockLeaveTransactionRepo,
      {} as unknown as CompOffRepository,
      mockEmployeeRepo,
      {} as unknown as BranchRepository,
      {} as unknown as AttendanceRepository,
      {} as unknown as ShiftService,
      mockAuditLogsService,
      mockAuthorizationService,
      mockConnection,
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
    leaveTransactionsStore.length = 0;
    auditLogsStore.length = 0;
    jest.clearAllMocks();

    mockSessionRepo.findActiveSessionByIdAndUserId.mockImplementation(
      (sId, uId) => {
        const sidStr = sId.toString();
        const uidStr = uId.toString();

        if (
          sidStr === adminSessionId.toString() &&
          uidStr === adminUserId.toString()
        ) {
          return Promise.resolve({
            _id: sId,
            userId: uId,
            isActive: true,
          } as unknown as SessionDocument);
        }

        if (
          sidStr === unauthorizedSessionId.toString() &&
          uidStr === unauthorizedUserId.toString()
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
      const uidStr = uId.toString();
      if (uidStr === adminUserId.toString()) {
        return Promise.resolve({
          _id: adminUserId,
          status: UserStatus.ACTIVE,
          roleIds: [adminRoleId],
        } as unknown as UserLean);
      }
      if (uidStr === unauthorizedUserId.toString()) {
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
        if (
          roleIds.some((r) => r.toString() === adminRoleId.toString()) &&
          perms.every((p) => p === PermissionKeys.LEAVE_BALANCES_ALLOCATE)
        ) {
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      },
    );
    mockAuthorizationService.hasPermission.mockImplementation(
      (actorIdOrRoles: Types.ObjectId | Types.ObjectId[], perm: string) => {
        if (perm === PermissionKeys.LEAVE_BALANCES_ALLOCATE) {
          if (Array.isArray(actorIdOrRoles)) {
            return Promise.resolve(
              actorIdOrRoles.some(
                (r) => r.toString() === adminRoleId.toString(),
              ),
            );
          }
          if (actorIdOrRoles.toString() === adminUserId.toString()) {
            return Promise.resolve(true);
          }
        }
        return Promise.resolve(false);
      },
    );
  });

  // ===========================================================================
  // 1. VALID ALLOCATION (HAPPY PATH)
  // ===========================================================================
  describe('Valid Leave Balance Allocation', () => {
    it('should allocate annual leave grant when days strictly equals leaveType.annualAllocation', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType({
        annualAllocation: 14,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 10,
      });

      const payload = {
        employeeId: employee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        year: 2026,
        days: 14, // Exact match
        carriedForwardDays: 4,
        remarks: 'Annual entitlement allocation 2026',
      };

      const response = await executeAllocateApi(payload);

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
      const balance = response.data[0];
      expect(balance.allocatedDays).toBe(14);
      expect(balance.carriedForwardDays).toBe(4);
      expect(balance.availableBalance).toBe(18);

      // Verify database persistence
      const stored = leaveBalancesStore.get(
        balanceKey(employee._id, leaveType._id, 2026),
      );
      expect(stored).toBeDefined();
      expect(stored?.allocatedDays).toBe(14);
      expect(stored?.carriedForwardDays).toBe(4);
      expect(stored?.availableBalance).toBe(18);

      // Verify immutable ALLOCATION transaction was recorded
      expect(leaveTransactionsStore).toHaveLength(1);
      const tx = leaveTransactionsStore[0];
      expect(tx.transactionType).toBe(LeaveTransactionType.ALLOCATION);
      expect(tx.days).toBe(14);
      expect(tx.newAvailable).toBe(18);
      expect(tx.employeeId.toString()).toBe(employee._id.toString());
      expect(tx.leaveTypeId.toString()).toBe(leaveType._id.toString());

      // Verify audit log
      expect(auditLogsStore).toHaveLength(1);
      expect(auditLogsStore[0].action).toBe(
        AuditAction.LEAVE_BALANCE_ALLOCATED,
      );
      expect(auditLogsStore[0].targetModel).toBe(
        AuditTargetModel.LEAVE_BALANCE,
      );
    });

    it('should allow valid allocation with default carriedForwardDays of 0 when omitted', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType({
        annualAllocation: 12,
        isCarryForwardEnabled: false,
      });

      const payload = {
        employeeId: employee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        year: 2026,
        days: 12,
      };

      const response = await executeAllocateApi(payload);

      expect(response.success).toBe(true);
      expect(response.data[0].allocatedDays).toBe(12);
      expect(response.data[0].carriedForwardDays).toBe(0);
      expect(response.data[0].availableBalance).toBe(12);
    });
  });

  // ===========================================================================
  // 2. MISMATCHED ANNUAL ALLOCATION VALIDATION
  // ===========================================================================
  describe('Strict Enforcement of annualAllocation', () => {
    it('should reject allocation when client days exceeds leaveType.annualAllocation with 400 Bad Request', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType({
        name: 'Annual Paid Leave',
        annualAllocation: 14,
      });

      const payload = {
        employeeId: employee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        year: 2026,
        days: 20, // Mismatched: 20 !== 14
      };

      await expect(executeAllocateApi(payload)).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: `Allocation days (20) does not match the standard annual entitlement of 14 days for leave type 'Annual Paid Leave'`,
      });

      // Assert zero database mutations
      expect(leaveBalancesStore.size).toBe(0);
      expect(leaveTransactionsStore).toHaveLength(0);
      expect(auditLogsStore).toHaveLength(0);
    });

    it('should reject allocation when client days is less than leaveType.annualAllocation with 400 Bad Request', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType({
        name: 'Sick Leave',
        annualAllocation: 10,
      });

      const payload = {
        employeeId: employee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        year: 2026,
        days: 5, // Mismatched: 5 !== 10
      };

      await expect(executeAllocateApi(payload)).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: `Allocation days (5) does not match the standard annual entitlement of 10 days for leave type 'Sick Leave'`,
      });

      expect(leaveBalancesStore.size).toBe(0);
      expect(leaveTransactionsStore).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 3. CARRY-FORWARD POLICY ENFORCEMENT
  // ===========================================================================
  describe('Carry-Forward Policy Enforcement', () => {
    it('should reject any carriedForwardDays > 0 when isCarryForwardEnabled is false with 400 Bad Request', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType({
        name: 'Casual Leave',
        annualAllocation: 12,
        isCarryForwardEnabled: false,
        maxCarryForwardDays: 0,
      });

      const payload = {
        employeeId: employee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        year: 2026,
        days: 12,
        carriedForwardDays: 3, // Disallowed because carry forward is disabled
      };

      await expect(executeAllocateApi(payload)).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: `Cannot allocate carried forward days because carry-forward is disabled for leave type 'Casual Leave'`,
      });

      expect(leaveBalancesStore.size).toBe(0);
      expect(leaveTransactionsStore).toHaveLength(0);
    });

    it('should reject carriedForwardDays exceeding maxCarryForwardDays with 400 Bad Request', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType({
        name: 'Privilege Leave',
        annualAllocation: 15,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 5,
      });

      const payload = {
        employeeId: employee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        year: 2026,
        days: 15,
        carriedForwardDays: 8, // Exceeds limit of 5
      };

      await expect(executeAllocateApi(payload)).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: `Carried forward days (8) exceeds the maximum allowed limit of 5 days for leave type 'Privilege Leave'`,
      });

      expect(leaveBalancesStore.size).toBe(0);
      expect(leaveTransactionsStore).toHaveLength(0);
    });

    it('should accept carriedForwardDays exactly equal to maxCarryForwardDays', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType({
        annualAllocation: 15,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 5,
      });

      const payload = {
        employeeId: employee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        year: 2026,
        days: 15,
        carriedForwardDays: 5, // Exactly equal to boundary
      };

      const response = await executeAllocateApi(payload);

      expect(response.success).toBe(true);
      expect(response.data[0].carriedForwardDays).toBe(5);
      expect(response.data[0].availableBalance).toBe(20);
    });

    it('should accept any carriedForwardDays when maxCarryForwardDays is 0 (unlimited carry-forward)', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType({
        annualAllocation: 15,
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 0, // 0 = unlimited
      });

      const payload = {
        employeeId: employee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        year: 2026,
        days: 15,
        carriedForwardDays: 45,
      };

      const response = await executeAllocateApi(payload);

      expect(response.success).toBe(true);
      expect(response.data[0].carriedForwardDays).toBe(45);
      expect(response.data[0].availableBalance).toBe(60);
    });
  });

  // ===========================================================================
  // 4. DUPLICATE ALLOCATION PREVENTION
  // ===========================================================================
  describe('Duplicate Allocation Prevention', () => {
    it('should reject duplicate allocation for the same employee, leave type and year with 409 Conflict', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType({
        name: 'Earned Leave',
        annualAllocation: 14,
      });

      const payload = {
        employeeId: employee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        year: 2026,
        days: 14,
      };

      // First allocation succeeds
      const firstResponse = await executeAllocateApi(payload);
      expect(firstResponse.success).toBe(true);

      // Second allocation for the same year must be rejected
      await expect(executeAllocateApi(payload)).rejects.toMatchObject({
        statusCode: HttpStatus.CONFLICT,
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        message: `Leave balance already allocated for employee for leave type 'Earned Leave' in year 2026. Use balance adjustment API to modify existing balance.`,
      });

      // Verify exactly 1 balance and 1 transaction exists (no double allocation)
      expect(leaveBalancesStore.size).toBe(1);
      expect(leaveTransactionsStore).toHaveLength(1);
    });

    it('should permit allocation in a different calendar year for the same employee and leave type', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType({ annualAllocation: 14 });

      // Allocate for 2026
      await executeAllocateApi({
        employeeId: employee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        year: 2026,
        days: 14,
      });

      // Allocate for 2027
      const response2027 = await executeAllocateApi({
        employeeId: employee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        year: 2027,
        days: 14,
      });

      expect(response2027.success).toBe(true);
      expect(leaveBalancesStore.size).toBe(2);
      expect(
        leaveBalancesStore.get(balanceKey(employee._id, leaveType._id, 2026)),
      ).toBeDefined();
      expect(
        leaveBalancesStore.get(balanceKey(employee._id, leaveType._id, 2027)),
      ).toBeDefined();
    });
  });

  // ===========================================================================
  // 5. CONCURRENT REQUESTS & RACE CONDITION PROTECTION
  // ===========================================================================
  describe('Concurrency & Race Condition Protection', () => {
    it('should catch MongoDB duplicate key error (11000) when concurrent allocations race and reject with 409 Conflict', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType({
        name: 'Annual Leave',
        annualAllocation: 14,
      });

      const payload = {
        employeeId: employee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        year: 2026,
        days: 14,
      };

      // Simulate concurrent execution:
      // Request 1 passes pre-check and successfully writes.
      // Request 2 also passed pre-check concurrently, but its upsertAllocation hits MongoDB E11000 unique index constraint.
      mockLeaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValueOnce(null); // Request 1 pre-check
      mockLeaveBalanceRepo.findByEmployeeTypeYear.mockResolvedValueOnce(null); // Request 2 pre-check

      // Request 1 completes
      await executeAllocateApi(payload);

      // Now request 2 hits database, simulate MongoDB E11000 duplicate index error
      mockLeaveBalanceRepo.upsertAllocation.mockRejectedValueOnce({
        code: 11000,
        message:
          'E11000 duplicate key error collection: crm_hrms.leave_balances index: uq_leave_balances_emp_type_year dup key: { employeeId: ObjectId("..."), leaveTypeId: ObjectId("..."), year: 2026 }',
      });

      await expect(executeAllocateApi(payload)).rejects.toMatchObject({
        statusCode: HttpStatus.CONFLICT,
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        message: `Leave balance already allocated for employee for leave type 'Annual Leave' in year 2026. Use balance adjustment API to modify existing balance.`,
      });

      // Exactly 1 balance and 1 transaction exist
      expect(leaveBalancesStore.size).toBe(1);
      expect(leaveTransactionsStore).toHaveLength(1);
    });
  });

  // ===========================================================================
  // 6. AUTHENTICATION & RBAC ENFORCEMENT
  // ===========================================================================
  describe('Authentication & RBAC Guards', () => {
    it('should reject with 401 Unauthorized when authorization token is omitted', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType();

      await expect(
        executeAllocateApi(
          {
            employeeId: employee._id.toString(),
            leaveTypeId: leaveType._id.toString(),
            year: 2026,
            days: leaveType.annualAllocation,
          },
          '', // Empty token
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.UNAUTHORIZED,
      });
    });

    it('should reject with 403 Forbidden when user lacks LEAVE_BALANCES_ALLOCATE permission', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType();

      await expect(
        executeAllocateApi(
          {
            employeeId: employee._id.toString(),
            leaveTypeId: leaveType._id.toString(),
            year: 2026,
            days: leaveType.annualAllocation,
          },
          unauthorizedToken,
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.FORBIDDEN,
      });
    });
  });

  // ===========================================================================
  // 7. EMPLOYMENT STATUS & INACTIVE LEAVE TYPE GUARDS
  // ===========================================================================
  describe('Status & Eligibility Guards', () => {
    it('should reject allocation for terminated employee with 403 Forbidden', async () => {
      const employee = createActiveEmployee({
        employmentStatus: EmploymentStatus.TERMINATED,
      });
      const leaveType = createLeaveType();

      await expect(
        executeAllocateApi({
          employeeId: employee._id.toString(),
          leaveTypeId: leaveType._id.toString(),
          year: 2026,
          days: leaveType.annualAllocation,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.FORBIDDEN,
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('should reject allocation for resigned employee with 403 Forbidden', async () => {
      const employee = createActiveEmployee({
        employmentStatus: EmploymentStatus.RESIGNED,
      });
      const leaveType = createLeaveType();

      await expect(
        executeAllocateApi({
          employeeId: employee._id.toString(),
          leaveTypeId: leaveType._id.toString(),
          year: 2026,
          days: leaveType.annualAllocation,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.FORBIDDEN,
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('should reject allocation for inactive leave type with 400 Bad Request', async () => {
      const employee = createActiveEmployee();
      const leaveType = createLeaveType({
        name: 'Deprecated Leave',
        isActive: false,
      });

      await expect(
        executeAllocateApi({
          employeeId: employee._id.toString(),
          leaveTypeId: leaveType._id.toString(),
          year: 2026,
          days: leaveType.annualAllocation,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: `Cannot allocate balance for inactive leave type 'Deprecated Leave'`,
      });
    });

    it('should reject allocation when employee status is not in leave type applicableEmploymentStatuses with 403 Forbidden', async () => {
      const employee = createActiveEmployee({
        employmentStatus: EmploymentStatus.PROBATION,
      });
      const leaveType = createLeaveType({
        name: 'Strict Active Only Leave',
        applicableEmploymentStatuses: [EmploymentStatus.ACTIVE],
      });

      await expect(
        executeAllocateApi({
          employeeId: employee._id.toString(),
          leaveTypeId: leaveType._id.toString(),
          year: 2026,
          days: leaveType.annualAllocation,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.FORBIDDEN,
        code: ErrorCode.FORBIDDEN,
        message: `Employees on '${employee.employmentStatus}' are not eligible for 'Strict Active Only Leave'`,
      });
    });
  });
});

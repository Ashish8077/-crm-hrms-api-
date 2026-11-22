/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
import { ProcessCarryForwardDto } from './dto/process-carry-forward.dto';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';

describe('Leave Carry Forward API Integration Suite (POST /api/v1/leaves/balances/carry-forward)', () => {
  let controller: LeavesController;
  let leavesService: LeavesService;
  let validationPipe: ValidationPipe;
  let jwtAuthGuard: JwtAuthGuard;
  let permissionsGuard: PermissionsGuard;
  let jwtService: JwtService;
  let reflector: jest.Mocked<Reflector>;

  // Security Identities
  const JWT_SECRET = 'enterprise-hrms-carry-forward-integration-secret-hs256';
  const adminUserId = new Types.ObjectId();
  const adminSessionId = new Types.ObjectId();
  const adminRoleId = new Types.ObjectId();

  const unauthorizedUserId = new Types.ObjectId();
  const unauthorizedSessionId = new Types.ObjectId();
  const unauthorizedRoleId = new Types.ObjectId();

  let validAdminToken: string;
  let unauthorizedToken: string;

  // In-memory Stateful Stores for true integration without external network dependence
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
    ipAddress?: string | null;
    userAgent?: string | null;
  }> = [];

  const balanceKey = (
    employeeId: Types.ObjectId | string,
    leaveTypeId: Types.ObjectId | string,
    year: number,
  ) => `${employeeId.toString()}_${leaveTypeId.toString()}_${year}`;

  // Mock Repositories backed by real in-memory stores
  let mockLeaveTypeRepo: jest.Mocked<LeaveTypeRepository>;
  let mockLeaveBalanceRepo: jest.Mocked<LeaveBalanceRepository>;
  let mockLeaveTransactionRepo: jest.Mocked<LeaveTransactionRepository>;
  let mockEmployeeRepo: jest.Mocked<EmployeeRepository>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;
  let mockAuthorizationService: jest.Mocked<AuthorizationService>;
  let mockSessionRepo: jest.Mocked<SessionRepository>;
  let mockUserRepo: jest.Mocked<UserRepository>;

  // Factory helpers for test entities
  const createActiveEmployee = (
    overrides?: Partial<EmployeeLean>,
  ): EmployeeLean => {
    const empId = new Types.ObjectId();
    const employee: EmployeeLean = {
      _id: empId,
      userId: new Types.ObjectId(),
      employeeCode: `EMP-CF-${Date.now().toString().slice(-4)}`,
      firstName: 'Priya',
      lastName: 'Sharma',
      workEmail: `priya.${Date.now()}@enterprise.com`,
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

  const createCarryForwardLeaveType = (
    overrides?: Partial<LeaveTypeLean>,
  ): LeaveTypeLean => {
    const ltId = new Types.ObjectId();
    const leaveType: LeaveTypeLean = {
      _id: ltId,
      name: 'Privilege Leave',
      code: 'PL',
      isPaid: true,
      annualAllocation: 15,
      allowHalfDay: true,
      allowNegativeBalance: false,
      allowDuringNoticePeriod: false,
      applicableEmploymentStatuses: [],
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

  const seedPreviousYearBalance = (
    employeeId: Types.ObjectId,
    leaveTypeId: Types.ObjectId,
    year: number,
    allocatedDays: number,
    usedDays: number,
    pendingDays = 0,
  ): LeaveBalanceLean => {
    const balance: LeaveBalanceLean = {
      _id: new Types.ObjectId(),
      employeeId,
      leaveTypeId,
      year,
      allocatedDays,
      carriedForwardDays: 0,
      creditedDays: 0,
      debitedDays: 0,
      pendingDays,
      usedDays,
      availableBalance: allocatedDays - usedDays - pendingDays,
      deletedAt: null,
      updatedBy: null,
      createdAt: new Date(`${year}-01-01`),
      updatedAt: new Date(`${year}-12-31`),
    };
    leaveBalancesStore.set(balanceKey(employeeId, leaveTypeId, year), balance);
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
   * Complete API invocation simulating the production HTTP pipeline:
   * 1. ValidationPipe: Schema transformation, validation, and error mapping
   * 2. JwtAuthGuard: Token verification and authentication session attachment
   * 3. PermissionsGuard: Enforces leaves:edit RBAC permissions
   * 4. LeavesController: Resolves actor context and delegates to LeavesService
   */
  const executeCarryForwardApi = async (
    rawPayload: unknown,
    token: string = validAdminToken,
  ) => {
    // 1. Validation Pipe execution
    const validatedDto = (await validationPipe.transform(rawPayload, {
      type: 'body',
      metatype: ProcessCarryForwardDto,
    })) as ProcessCarryForwardDto;

    // 2. Security Guards execution
    const ctx = createMockContext(token, rawPayload);
    reflector.getAllAndOverride.mockReturnValue(false); // Route is not public
    await jwtAuthGuard.canActivate(ctx);

    // Mock reflection for PermissionsGuard (requires LEAVE_BALANCES_CARRY_FORWARD)
    reflector.getAllAndOverride.mockReturnValue([
      PermissionKeys.LEAVE_BALANCES_CARRY_FORWARD,
    ]);
    await permissionsGuard.canActivate(ctx);

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return controller.processCarryForward(validatedDto, req);
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
      findList: jest.fn(
        (
          filter: { isCarryForwardEnabled?: boolean; isActive?: boolean },
          page = 1,
          limit = 100,
        ): Promise<PaginatedResult<LeaveTypeLean>> => {
          const all = Array.from(leaveTypesStore.values()).filter((lt) => {
            if (lt.deletedAt) return false;
            if (
              filter.isCarryForwardEnabled !== undefined &&
              lt.isCarryForwardEnabled !== filter.isCarryForwardEnabled
            )
              return false;
            if (
              filter.isActive !== undefined &&
              lt.isActive !== filter.isActive
            )
              return false;
            return true;
          });
          return Promise.resolve({
            data: all.slice((page - 1) * limit, page * limit),
            meta: {
              page,
              limit,
              total: all.length,
              totalPages: Math.ceil(all.length / limit),
              hasNextPage: page * limit < all.length,
              hasPreviousPage: page > 1,
            },
          });
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
      findList: jest.fn((): Promise<PaginatedResult<EmployeeLean>> => {
        const all = Array.from(employeesStore.values()).filter(
          (e) => !e.deletedAt,
        );
        return Promise.resolve({
          data: all,
          meta: {
            page: 1,
            limit: 1000,
            total: all.length,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        });
      }),
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
          carriedForwardDays = 0,
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
      findCarryForwardTransaction: jest.fn(
        (
          employeeId: Types.ObjectId | string,
          leaveTypeId: Types.ObjectId | string,
          year: number,
        ): Promise<LeaveTransactionLean | null> => {
          const found = leaveTransactionsStore.find(
            (tx) =>
              tx.employeeId.toString() === employeeId.toString() &&
              tx.leaveTypeId.toString() === leaveTypeId.toString() &&
              tx.year === year &&
              tx.transactionType === LeaveTransactionType.CARRY_FORWARD,
          );
          return Promise.resolve(found ? { ...found } : null);
        },
      ),
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
          ipAddress?: string | null;
          userAgent?: string | null;
        }) => {
          auditLogsStore.push(params);
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
    // Reset stores and mock configurations
    employeesStore.clear();
    leaveTypesStore.clear();
    leaveBalancesStore.clear();
    leaveTransactionsStore.length = 0;
    auditLogsStore.length = 0;
    jest.clearAllMocks();

    // Default Session and User mocks for admin user
    mockSessionRepo.findActiveSessionByIdAndUserId.mockImplementation(
      (sId, uId) => {
        if (
          sId.toString() === adminSessionId.toString() &&
          uId.toString() === adminUserId.toString()
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
      if (uId.toString() === adminUserId.toString()) {
        return Promise.resolve({
          _id: adminUserId,
          status: UserStatus.ACTIVE,
          roleIds: [adminRoleId],
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

    // Default permissions: admin has carry-forward permission
    mockAuthorizationService.hasPermission.mockImplementation(
      (_roleIds, perm) => {
        if (
          perm === PermissionKeys.LEAVE_BALANCES_CARRY_FORWARD ||
          perm === PermissionKeys.LEAVES_EDIT
        ) {
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      },
    );
    mockAuthorizationService.hasPermissions.mockImplementation(
      (_roleIds, perms) => {
        return Promise.resolve(
          perms.includes(PermissionKeys.LEAVE_BALANCES_CARRY_FORWARD) ||
            perms.includes(PermissionKeys.LEAVES_EDIT),
        );
      },
    );
  });

  // ===========================================================================
  // 1. CORE CARRY FORWARD EXECUTION & VERIFICATION (Requirements 1 - 8)
  // ===========================================================================
  describe('1. Core Carry Forward Execution & Verification (Requirements 1 - 8)', () => {
    it('should successfully execute carry forward: cap 8 unused days to 5 max limit, create target balance, record immutable ledger, and preserve existing fields', async () => {
      // 1. Create fresh test data for active employee
      const activeEmployee = createActiveEmployee();

      // 2. Configure Leave Type: isCarryForwardEnabled = true, maxCarryForwardDays = 5
      const leaveType = createCarryForwardLeaveType({
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 5,
      });

      // 3. Create previous-year balance (2025):
      //    Allocated: 12 days, Used: 4 days, Pending: 0 days => Eligible unused: 8 days
      const prevBalance = seedPreviousYearBalance(
        activeEmployee._id,
        leaveType._id,
        2025,
        12,
        4,
        0,
      );
      expect(prevBalance.availableBalance).toBe(8);

      // 4. Ensure no previous carry-forward exists for the target year (2026)
      const existingTx =
        await mockLeaveTransactionRepo.findCarryForwardTransaction(
          activeEmployee._id,
          leaveType._id,
          2026,
        );
      expect(existingTx).toBeNull();

      // 5. Execute the Carry Forward API through production pipeline
      const payload = {
        employeeId: activeEmployee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        fromYear: 2025,
        toYear: 2026,
      };

      const response = await executeCarryForwardApi(payload);

      // 6. Verify: API returns the expected success response
      expect(response.success).toBe(true);
      expect(response.data).toEqual({
        fromYear: 2025,
        toYear: 2026,
        processedEmployees: 1,
        totalCarriedForwardDays: 5, // Exactly 5 days carried forward (capped at maxCarryForwardDays)
      });

      // 7. Verify: Target-year balance is updated correctly in the store
      const targetBalance = leaveBalancesStore.get(
        balanceKey(activeEmployee._id, leaveType._id, 2026),
      );
      expect(targetBalance).toBeDefined();
      expect(targetBalance!.year).toBe(2026);
      expect(targetBalance!.allocatedDays).toBe(0);
      expect(targetBalance!.carriedForwardDays).toBe(5);
      expect(targetBalance!.availableBalance).toBe(5);
      expect(targetBalance!.usedDays).toBe(0);
      expect(targetBalance!.pendingDays).toBe(0);

      // 8. Verify: Exactly one CARRY_FORWARD ledger transaction is created
      expect(leaveTransactionsStore.length).toBe(1);
      const ledgerEntry = leaveTransactionsStore[0];
      expect(ledgerEntry.employeeId.toString()).toBe(
        activeEmployee._id.toString(),
      );
      expect(ledgerEntry.leaveTypeId.toString()).toBe(leaveType._id.toString());
      expect(ledgerEntry.year).toBe(2026);
      expect(ledgerEntry.transactionType).toBe(
        LeaveTransactionType.CARRY_FORWARD,
      );
      expect(ledgerEntry.days).toBe(5);
      expect(ledgerEntry.previousAvailable).toBe(0);
      expect(ledgerEntry.newAvailable).toBe(5);
      expect(ledgerEntry.referenceType).toBe('YearEndCarryForward');
      expect(ledgerEntry.actorId.toString()).toBe(adminUserId.toString());
      expect(ledgerEntry.remarks).toBe(
        'Year-end carry forward of 5 days from year 2025',
      );

      // 9. Verify: Existing previous-year balance fields are not overwritten
      const sourceBalance = leaveBalancesStore.get(
        balanceKey(activeEmployee._id, leaveType._id, 2025),
      );
      expect(sourceBalance).toBeDefined();
      expect(sourceBalance!.allocatedDays).toBe(12);
      expect(sourceBalance!.usedDays).toBe(4);
      expect(sourceBalance!.pendingDays).toBe(0);
      expect(sourceBalance!.availableBalance).toBe(8);

      // 10. Verify: Audit log created with full traceability
      expect(auditLogsStore.length).toBe(1);
      expect(auditLogsStore[0].action).toBe(AuditAction.LEAVE_BALANCE_ADJUSTED);
      expect(auditLogsStore[0].targetModel).toBe(
        AuditTargetModel.LEAVE_BALANCE,
      );
      expect(auditLogsStore[0].details).toEqual({
        fromYear: 2025,
        toYear: 2026,
        employeeId: activeEmployee._id,
        leaveTypeId: leaveType._id,
        carriedForwardDays: 5,
      });
    });

    it('should add carry forward to existing target year allocation without overwriting existing fields', async () => {
      const activeEmployee = createActiveEmployee();
      const leaveType = createCarryForwardLeaveType({
        maxCarryForwardDays: 5,
      });

      // Previous year: 8 unused days
      seedPreviousYearBalance(
        activeEmployee._id,
        leaveType._id,
        2025,
        12,
        4,
        0,
      );

      // Target year already has an annual allocation grant of 10 days
      const initialTargetBalance: LeaveBalanceLean = {
        _id: new Types.ObjectId(),
        employeeId: activeEmployee._id,
        leaveTypeId: leaveType._id,
        year: 2026,
        allocatedDays: 10,
        carriedForwardDays: 0,
        creditedDays: 0,
        debitedDays: 0,
        pendingDays: 0,
        usedDays: 0,
        availableBalance: 10,
        deletedAt: null,
        updatedBy: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };
      leaveBalancesStore.set(
        balanceKey(activeEmployee._id, leaveType._id, 2026),
        initialTargetBalance,
      );

      // Execute Carry Forward API
      const response = await executeCarryForwardApi({
        employeeId: activeEmployee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        fromYear: 2025,
        toYear: 2026,
      });

      expect(response.data.totalCarriedForwardDays).toBe(5);

      // Target balance should preserve allocatedDays: 10 and add carriedForwardDays: 5 => total available 15
      const targetBalance = leaveBalancesStore.get(
        balanceKey(activeEmployee._id, leaveType._id, 2026),
      );
      expect(targetBalance).toBeDefined();
      expect(targetBalance!.allocatedDays).toBe(10); // Preserved!
      expect(targetBalance!.carriedForwardDays).toBe(5);
      expect(targetBalance!.availableBalance).toBe(15);

      // Ledger transaction records accurate previous (10) and new available (15)
      expect(leaveTransactionsStore.length).toBe(1);
      expect(leaveTransactionsStore[0].previousAvailable).toBe(10);
      expect(leaveTransactionsStore[0].newAvailable).toBe(15);
    });
  });

  // ===========================================================================
  // 2. LIMIT BOUNDARY & UNDER-LIMIT CALCULATIONS
  // ===========================================================================
  describe('2. Limit Boundary & Under-Limit Calculations', () => {
    it('should carry forward exact unused days when unused balance is less than maxCarryForwardDays', async () => {
      const activeEmployee = createActiveEmployee();
      const leaveType = createCarryForwardLeaveType({
        maxCarryForwardDays: 10,
      });

      // Previous year: Allocated 10, Used 7 => Unused = 3 (< 10 limit)
      seedPreviousYearBalance(
        activeEmployee._id,
        leaveType._id,
        2025,
        10,
        7,
        0,
      );

      const response = await executeCarryForwardApi({
        employeeId: activeEmployee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        fromYear: 2025,
        toYear: 2026,
      });

      expect(response.data.totalCarriedForwardDays).toBe(3);

      const targetBalance = leaveBalancesStore.get(
        balanceKey(activeEmployee._id, leaveType._id, 2026),
      );
      expect(targetBalance!.carriedForwardDays).toBe(3);
      expect(targetBalance!.availableBalance).toBe(3);
    });

    it('should carry forward exactly maxCarryForwardDays when unused balance equals the limit', async () => {
      const activeEmployee = createActiveEmployee();
      const leaveType = createCarryForwardLeaveType({
        maxCarryForwardDays: 5,
      });

      // Previous year: Allocated 10, Used 5 => Unused = 5 (exactly equal to limit)
      seedPreviousYearBalance(
        activeEmployee._id,
        leaveType._id,
        2025,
        10,
        5,
        0,
      );

      const response = await executeCarryForwardApi({
        employeeId: activeEmployee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        fromYear: 2025,
        toYear: 2026,
      });

      expect(response.data.totalCarriedForwardDays).toBe(5);
    });

    it('should carry forward 0 days and create no ledger transaction when previous year balance is zero or negative', async () => {
      const activeEmployee = createActiveEmployee();
      const leaveType = createCarryForwardLeaveType({
        maxCarryForwardDays: 5,
      });

      // Previous year: 0 available days
      seedPreviousYearBalance(
        activeEmployee._id,
        leaveType._id,
        2025,
        10,
        10,
        0,
      );

      const response = await executeCarryForwardApi({
        employeeId: activeEmployee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        fromYear: 2025,
        toYear: 2026,
      });

      expect(response.data.totalCarriedForwardDays).toBe(0);
      expect(response.data.processedEmployees).toBe(1);

      // Target balance should not exist and no ledger transaction created
      const targetBalance = leaveBalancesStore.get(
        balanceKey(activeEmployee._id, leaveType._id, 2026),
      );
      expect(targetBalance).toBeUndefined();
      expect(leaveTransactionsStore.length).toBe(0);
    });

    it('Test 5: should carry forward 0 days when maxCarryForwardDays is 0 (0 means no carry-forward allowed, not unlimited)', async () => {
      const activeEmployee = createActiveEmployee();
      const leaveType = createCarryForwardLeaveType({
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 0,
      });

      // Previous year: 8 unused days
      seedPreviousYearBalance(
        activeEmployee._id,
        leaveType._id,
        2025,
        12,
        4,
        0,
      );

      const response = await executeCarryForwardApi({
        employeeId: activeEmployee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        fromYear: 2025,
        toYear: 2026,
      });

      expect(response.success).toBe(true);
      expect(response.data.totalCarriedForwardDays).toBe(0);

      // Target balance should not exist and no ledger transaction created
      const targetBalance = leaveBalancesStore.get(
        balanceKey(activeEmployee._id, leaveType._id, 2026),
      );
      expect(targetBalance).toBeUndefined();
      expect(leaveTransactionsStore.length).toBe(0);
    });

    it('Test 5: should carry forward 0 days when maxCarryForwardDays is 0 (0 means no carry-forward allowed, not unlimited)', async () => {
      const activeEmployee = createActiveEmployee();
      const leaveType = createCarryForwardLeaveType({
        isCarryForwardEnabled: true,
        maxCarryForwardDays: 0,
      });

      // Previous year: 8 unused days
      seedPreviousYearBalance(
        activeEmployee._id,
        leaveType._id,
        2025,
        12,
        4,
        0,
      );

      const response = await executeCarryForwardApi({
        employeeId: activeEmployee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        fromYear: 2025,
        toYear: 2026,
      });

      expect(response.success).toBe(true);
      expect(response.data.totalCarriedForwardDays).toBe(0);

      // Target balance should not exist and no ledger transaction created
      const targetBalance = leaveBalancesStore.get(
        balanceKey(activeEmployee._id, leaveType._id, 2026),
      );
      expect(targetBalance).toBeUndefined();
      expect(leaveTransactionsStore.length).toBe(0);
    });
  });

  // ===========================================================================
  // 3. DUPLICATE EXECUTION & IDEMPOTENCY PROTECTION
  // ===========================================================================
  describe('3. Duplicate Execution & Idempotency Protection', () => {
    it('should reject duplicate execution with 409 Conflict without double-crediting', async () => {
      const activeEmployee = createActiveEmployee();
      const leaveType = createCarryForwardLeaveType({
        maxCarryForwardDays: 5,
      });

      seedPreviousYearBalance(
        activeEmployee._id,
        leaveType._id,
        2025,
        12,
        4,
        0,
      );

      // First run: Success
      await executeCarryForwardApi({
        employeeId: activeEmployee._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        fromYear: 2025,
        toYear: 2026,
      });
      expect(leaveTransactionsStore.length).toBe(1);

      // Second run: Rejection with 409 Conflict
      await expect(
        executeCarryForwardApi({
          employeeId: activeEmployee._id.toString(),
          leaveTypeId: leaveType._id.toString(),
          fromYear: 2025,
          toYear: 2026,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.CONFLICT,
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        message: expect.stringContaining(
          `Carry forward for leave type '${leaveType.name}' has already been processed for year 2026`,
        ),
      });

      // Ensure no double-crediting
      expect(leaveTransactionsStore.length).toBe(1);
      const targetBalance = leaveBalancesStore.get(
        balanceKey(activeEmployee._id, leaveType._id, 2026),
      );
      expect(targetBalance!.carriedForwardDays).toBe(5);
      expect(targetBalance!.availableBalance).toBe(5);
    });
  });

  // ===========================================================================
  // 4. BUSINESS POLICY & VALIDATION GUARDS
  // ===========================================================================
  describe('4. Business Policy & Validation Guards', () => {
    it('should reject non-consecutive years (e.g. 2024 to 2026) with 400 Bad Request', async () => {
      const activeEmployee = createActiveEmployee();
      const leaveType = createCarryForwardLeaveType();

      await expect(
        executeCarryForwardApi({
          employeeId: activeEmployee._id.toString(),
          leaveTypeId: leaveType._id.toString(),
          fromYear: 2024,
          toYear: 2026,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message:
          'toYear must be consecutive to fromYear (exactly fromYear + 1)',
      });
    });

    it('should reject target year less than or equal to source year with 400 Bad Request', async () => {
      const activeEmployee = createActiveEmployee();
      const leaveType = createCarryForwardLeaveType();

      await expect(
        executeCarryForwardApi({
          employeeId: activeEmployee._id.toString(),
          leaveTypeId: leaveType._id.toString(),
          fromYear: 2026,
          toYear: 2025,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'fromYear must be strictly less than toYear',
      });
    });

    it('should reject when leave type is inactive with 400 Bad Request', async () => {
      const activeEmployee = createActiveEmployee();
      const inactiveLeaveType = createCarryForwardLeaveType({
        isActive: false,
      });

      await expect(
        executeCarryForwardApi({
          employeeId: activeEmployee._id.toString(),
          leaveTypeId: inactiveLeaveType._id.toString(),
          fromYear: 2025,
          toYear: 2026,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: `Cannot carry forward for inactive leave type '${inactiveLeaveType.name}'`,
      });
    });

    it('should reject when leave type has isCarryForwardEnabled = false with 400 Bad Request', async () => {
      const activeEmployee = createActiveEmployee();
      const disabledLeaveType = createCarryForwardLeaveType({
        isCarryForwardEnabled: false,
      });

      await expect(
        executeCarryForwardApi({
          employeeId: activeEmployee._id.toString(),
          leaveTypeId: disabledLeaveType._id.toString(),
          fromYear: 2025,
          toYear: 2026,
        }),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: `Leave type '${disabledLeaveType.name}' does not have carry forward enabled`,
      });
    });

    it('should reject terminated, resigned, and notice period employees with 400 Bad Request according to eligibility policy', async () => {
      const leaveType = createCarryForwardLeaveType();

      const ineligibleStatuses = [
        EmploymentStatus.TERMINATED,
        EmploymentStatus.RESIGNED,
        EmploymentStatus.NOTICE_PERIOD,
      ];

      for (const status of ineligibleStatuses) {
        const emp = createActiveEmployee({ employmentStatus: status });

        await expect(
          executeCarryForwardApi({
            employeeId: emp._id.toString(),
            leaveTypeId: leaveType._id.toString(),
            fromYear: 2025,
            toYear: 2026,
          }),
        ).rejects.toMatchObject({
          statusCode: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Employee is not eligible for leave carry forward',
        });
      }
    });

    it('should permit probation employee for carry forward', async () => {
      const probationEmp = createActiveEmployee({
        employmentStatus: EmploymentStatus.PROBATION,
      });
      const leaveType = createCarryForwardLeaveType({
        maxCarryForwardDays: 5,
      });

      seedPreviousYearBalance(probationEmp._id, leaveType._id, 2025, 10, 6, 0);

      const response = await executeCarryForwardApi({
        employeeId: probationEmp._id.toString(),
        leaveTypeId: leaveType._id.toString(),
        fromYear: 2025,
        toYear: 2026,
      });

      expect(response.success).toBe(true);
      expect(response.data.totalCarriedForwardDays).toBe(4);
    });
  });

  // ===========================================================================
  // 5. BATCH AUTOMATION (Organization-wide carry forward)
  // ===========================================================================
  describe('5. Batch Organization-wide Carry Forward Automation', () => {
    it('should execute batch carry-forward across all eligible employees and enabled types, excluding ineligible statuses', async () => {
      const leaveTypePL = createCarryForwardLeaveType({
        name: 'Privilege Leave',
        code: 'PL',
        maxCarryForwardDays: 5,
      });
      createCarryForwardLeaveType({
        name: 'Casual Leave (No CF)',
        code: 'CL',
        isCarryForwardEnabled: false,
        maxCarryForwardDays: 0,
      });

      // Employee 1: Active (Eligible)
      const emp1 = createActiveEmployee({
        employmentStatus: EmploymentStatus.ACTIVE,
      });
      seedPreviousYearBalance(emp1._id, leaveTypePL._id, 2025, 12, 4, 0); // 8 unused -> 5 cf

      // Employee 2: Probation (Eligible)
      const emp2 = createActiveEmployee({
        employmentStatus: EmploymentStatus.PROBATION,
      });
      seedPreviousYearBalance(emp2._id, leaveTypePL._id, 2025, 10, 8, 0); // 2 unused -> 2 cf

      // Employee 3: Notice Period (Ineligible for auto carry forward)
      const emp3 = createActiveEmployee({
        employmentStatus: EmploymentStatus.NOTICE_PERIOD,
      });
      seedPreviousYearBalance(emp3._id, leaveTypePL._id, 2025, 12, 2, 0);

      // Employee 4: Terminated (Ineligible)
      const emp4 = createActiveEmployee({
        employmentStatus: EmploymentStatus.TERMINATED,
      });
      seedPreviousYearBalance(emp4._id, leaveTypePL._id, 2025, 12, 2, 0);

      // Execute batch carry forward (omitting employeeId and leaveTypeId)
      const response = await executeCarryForwardApi({
        fromYear: 2025,
        toYear: 2026,
      });

      expect(response.success).toBe(true);
      expect(response.data.processedEmployees).toBe(2);
      expect(response.data.totalCarriedForwardDays).toBe(7); // 5 from emp1 + 2 from emp2

      // Verify emp1 target balance
      const emp1Balance = leaveBalancesStore.get(
        balanceKey(emp1._id, leaveTypePL._id, 2026),
      );
      expect(emp1Balance!.carriedForwardDays).toBe(5);

      // Verify emp2 target balance
      const emp2Balance = leaveBalancesStore.get(
        balanceKey(emp2._id, leaveTypePL._id, 2026),
      );
      expect(emp2Balance!.carriedForwardDays).toBe(2);

      // Verify emp3 (notice period) received no target balance
      const emp3Balance = leaveBalancesStore.get(
        balanceKey(emp3._id, leaveTypePL._id, 2026),
      );
      expect(emp3Balance).toBeUndefined();

      // Verify emp4 (terminated) received no target balance
      const emp4Balance = leaveBalancesStore.get(
        balanceKey(emp4._id, leaveTypePL._id, 2026),
      );
      expect(emp4Balance).toBeUndefined();
    });
  });

  // ===========================================================================
  // 6. SECURITY, AUTHENTICATION & RBAC CONTROLS
  // ===========================================================================
  describe('6. Security, Authentication & RBAC Controls', () => {
    it('should reject unauthenticated request with 401 Unauthorized', async () => {
      const ctx = createMockContext(undefined, {
        fromYear: 2025,
        toYear: 2026,
      });
      reflector.getAllAndOverride.mockReturnValue(false); // Route is not public

      await expect(jwtAuthGuard.canActivate(ctx)).rejects.toMatchObject({
        statusCode: HttpStatus.UNAUTHORIZED,
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid or expired access token',
      });
    });

    it('should reject request when caller lacks leaves:edit permission with 403 Forbidden', async () => {
      const ctx = createMockContext(unauthorizedToken, {
        fromYear: 2025,
        toYear: 2026,
      });
      reflector.getAllAndOverride.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      // Mock user without LEAVES_EDIT permission
      mockAuthorizationService.hasPermissions.mockResolvedValueOnce(false);
      reflector.getAllAndOverride.mockReturnValue([
        PermissionKeys.LEAVE_BALANCES_CARRY_FORWARD,
      ]);

      await expect(permissionsGuard.canActivate(ctx)).rejects.toMatchObject({
        statusCode: HttpStatus.FORBIDDEN,
        code: ErrorCode.FORBIDDEN,
        message: expect.stringContaining(
          `Insufficient permission. Required: ${PermissionKeys.LEAVE_BALANCES_CARRY_FORWARD}`,
        ),
      });
    });

    it('should reject request when body fails DTO validation (out of range year, invalid MongoId)', async () => {
      await expect(
        validationPipe.transform(
          {
            fromYear: 1990, // < 2000
            toYear: 'not-a-number',
            employeeId: 'invalid-mongo-id',
          },
          { type: 'body', metatype: ProcessCarryForwardDto },
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });
});

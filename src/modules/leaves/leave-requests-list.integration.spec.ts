/* eslint-disable @typescript-eslint/unbound-method */
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
  LeaveRequestRepository,
  LeaveRequestLean,
} from './repositories/leave-request.repository';
import { HolidayRepository } from './repositories/holiday.repository';
import { LeaveBalanceRepository } from './repositories/leave-balance.repository';
import { LeaveTransactionRepository } from './repositories/leave-transaction.repository';
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
import { LeaveRequestStatus } from './constants/leaves.constant';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { ListLeaveRequestsQueryDto } from './dto/list-leave-requests-query.dto';
import { ListPendingApprovalsQueryDto } from './dto/list-pending-approvals-query.dto';
import { buildPaginationMeta } from '../../common/pagination/pagination.util';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('List Leave Requests API Production Integration Suite (GET /api/v1/leaves/requests)', () => {
  let controller: LeavesController;
  let leavesService: LeavesService;
  let validationPipe: ValidationPipe;
  let jwtAuthGuard: JwtAuthGuard;
  let permissionsGuard: PermissionsGuard;
  let jwtService: JwtService;
  let reflector: Reflector;
  let getAllAndOverrideSpy: jest.SpyInstance;

  // Security Identities
  const JWT_SECRET = 'enterprise-hrms-list-leave-requests-secret-hs256';

  // 1. HR Admin (Has global leaves:view permission)
  const hrUserId = new Types.ObjectId();
  const hrSessionId = new Types.ObjectId();
  const hrRoleId = new Types.ObjectId();

  // 2. Manager (Reports to no one, manages Employee 1 and Employee 2)
  const managerUserId = new Types.ObjectId();
  const managerSessionId = new Types.ObjectId();
  const managerRoleId = new Types.ObjectId();
  const managerEmployeeId = new Types.ObjectId();

  // 3. Regular Employee 1 (Direct report of Manager)
  const emp1UserId = new Types.ObjectId();
  const emp1SessionId = new Types.ObjectId();
  const emp1RoleId = new Types.ObjectId();
  const emp1Id = new Types.ObjectId();

  // 4. Regular Employee 2 (Direct report of Manager)
  const emp2Id = new Types.ObjectId();

  // 5. Unrelated Employee 3 (Reports to a different department/manager)
  const unrelatedEmpId = new Types.ObjectId();

  // 6. Unauthorized User (No roles / no permissions)
  const unauthorizedUserId = new Types.ObjectId();
  const unauthorizedSessionId = new Types.ObjectId();
  const unauthorizedRoleId = new Types.ObjectId();

  let hrToken: string;
  let managerToken: string;
  let emp1Token: string;
  let unauthorizedToken: string;

  // In-memory Stores
  const employeesStore = new Map<string, EmployeeLean>();
  const leaveTypesStore = new Map<string, LeaveTypeLean>();
  const leaveRequestsStore = new Map<string, LeaveRequestLean>();

  // Mock Repositories & Services
  let mockLeaveRequestRepo: jest.Mocked<LeaveRequestRepository>;
  let mockLeaveTypeRepo: jest.Mocked<LeaveTypeRepository>;
  let mockEmployeeRepo: jest.Mocked<EmployeeRepository>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;
  let mockAuthorizationService: jest.Mocked<AuthorizationService>;
  let mockSessionRepo: jest.Mocked<SessionRepository>;
  let mockUserRepo: jest.Mocked<UserRepository>;

  // Fixture Creators
  const createEmployee = (
    overrides: Partial<EmployeeLean> = {},
  ): EmployeeLean => {
    const id = overrides._id ?? new Types.ObjectId();
    const employee: EmployeeLean = {
      _id: id,
      userId: new Types.ObjectId(),
      employeeCode: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
      firstName: 'Test',
      lastName: 'Employee',
      workEmail: `test-${id.toString()}@enterprise.com`,
      phoneNumber: '+919876543210',
      branchId: new Types.ObjectId(),
      shiftId: new Types.ObjectId(),
      departmentId: new Types.ObjectId(),
      designationId: new Types.ObjectId(),
      reportingManagerId: null,
      employmentStatus: EmploymentStatus.ACTIVE,
      employmentType: EmploymentType.FULL_TIME,
      dateOfJoining: new Date('2024-01-01'),
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
    employeesStore.set(id.toString(), employee);
    return employee;
  };

  const createLeaveType = (
    overrides: Partial<LeaveTypeLean> = {},
  ): LeaveTypeLean => {
    const id = overrides._id ?? new Types.ObjectId();
    const leaveType: LeaveTypeLean = {
      _id: id,
      name: 'Paid Time Off',
      code: `PTO-${Math.floor(100 + Math.random() * 900)}`,
      description: 'General paid time off',
      isPaid: true,
      annualAllocation: 18,
      allowHalfDay: true,
      allowNegativeBalance: false,
      requiresAttachment: false,
      maxConsecutiveDays: 30,
      applicableEmploymentStatuses: [
        EmploymentStatus.ACTIVE,
        EmploymentStatus.PROBATION,
      ],
      allowDuringNoticePeriod: true,
      deductWeekends: false,
      deductHolidays: false,
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
    leaveTypesStore.set(id.toString(), leaveType);
    return leaveType;
  };

  const createLeaveRequest = (
    overrides: Partial<LeaveRequestLean> = {},
  ): LeaveRequestLean => {
    const id = overrides._id ?? new Types.ObjectId();
    const ltId = overrides.leaveTypeId ?? new Types.ObjectId();
    const lt = leaveTypesStore.get(ltId.toString());

    const defaultSnapshot = {
      name: lt?.name ?? 'Paid Time Off',
      code: lt?.code ?? 'PTO',
      isPaid: lt?.isPaid ?? true,
      allowHalfDay: lt?.allowHalfDay ?? true,
      deductWeekends: lt?.deductWeekends ?? false,
      deductHolidays: lt?.deductHolidays ?? false,
    };

    const req: LeaveRequestLean = {
      _id: id,
      employeeId: emp1Id,
      leaveTypeId: ltId,
      leaveTypeSnapshot: overrides.leaveTypeSnapshot ?? defaultSnapshot,
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      totalDays: 3,
      isHalfDay: false,
      halfDaySession: null,
      yearBreakdown: [{ year: 2026, days: 3 }],
      reason: 'Standard vacation leave',
      attachmentUrl: undefined,
      reportingManagerId: managerEmployeeId,
      status: LeaveRequestStatus.PENDING,
      rejectionReason: undefined,
      cancellationReason: undefined,
      cancellationReviewedBy: null,
      cancellationReviewedAt: null,
      reconciliationNotes: undefined,
      approvalTimeline: [],
      appliedAt: new Date('2026-05-15T09:00:00.000Z'),
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
      createdAt: new Date('2026-05-15T09:00:00.000Z'),
      updatedAt: new Date('2026-05-15T09:00:00.000Z'),
      ...overrides,
    };
    leaveRequestsStore.set(id.toString(), req);
    return req;
  };

  const createMockContext = (
    token?: string,
    query: unknown = {},
  ): ExecutionContext => {
    const req = {
      cookies: token ? { access_token: token } : {},
      headers: {
        'user-agent': 'JestIntegration/1.0',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ip: '127.0.0.1',
      query,
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
   * 3. PermissionsGuard: LEAVES_VIEW RBAC check
   * 4. LeavesController: Resolves actor context and delegates to LeavesService.listRequests
   */
  const executeListRequestsApi = async (
    rawQuery: unknown = {},
    token: string = hrToken,
  ) => {
    // 1. Validation Pipe execution
    const validatedQuery = (await validationPipe.transform(rawQuery, {
      type: 'query',
      metatype: ListLeaveRequestsQueryDto,
    })) as ListLeaveRequestsQueryDto;

    // 2. Security Guards execution
    const ctx = createMockContext(token, rawQuery);
    getAllAndOverrideSpy.mockReturnValue(false); // Route is not public
    await jwtAuthGuard.canActivate(ctx);

    // Mock reflection for PermissionsGuard (requires LEAVE_REQUESTS_VIEW_TEAM)
    getAllAndOverrideSpy.mockReturnValue([
      PermissionKeys.LEAVE_REQUESTS_VIEW_TEAM,
    ]);
    await permissionsGuard.canActivate(ctx);

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return controller.listRequests(validatedQuery, req);
  };

  /**
   * Complete HTTP Pipeline Execution for Pending Approvals:
   * 1. ValidationPipe: Schema transform, validate against ListPendingApprovalsQueryDto
   * 2. JwtAuthGuard: Token verification and session attachment
   * 3. PermissionsGuard: LEAVES_APPROVE RBAC check
   * 4. LeavesController: Resolves actor context and delegates to LeavesService.getPendingApprovals
   */
  const executeGetPendingApprovalsApi = async (
    rawQuery: unknown = {},
    token: string = managerToken,
  ) => {
    // 1. Validation Pipe execution
    const validatedQuery = (await validationPipe.transform(rawQuery, {
      type: 'query',
      metatype: ListPendingApprovalsQueryDto,
    })) as ListPendingApprovalsQueryDto;

    // 2. Security Guards execution
    const ctx = createMockContext(token, rawQuery);
    getAllAndOverrideSpy.mockReturnValue(false); // Route is not public
    await jwtAuthGuard.canActivate(ctx);

    // Mock reflection for PermissionsGuard (requires LEAVE_REQUESTS_VIEW_PENDING_APPROVALS)
    getAllAndOverrideSpy.mockReturnValue([
      PermissionKeys.LEAVE_REQUESTS_VIEW_PENDING_APPROVALS,
    ]);
    await permissionsGuard.canActivate(ctx);

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return controller.getPendingApprovals(validatedQuery, req);
  };

  beforeAll(() => {
    jwtService = new JwtService({ secret: JWT_SECRET });

    hrToken = jwtService.sign({
      sub: hrUserId.toString(),
      sid: hrSessionId.toString(),
      type: 'access',
    });

    managerToken = jwtService.sign({
      sub: managerUserId.toString(),
      sid: managerSessionId.toString(),
      type: 'access',
    });

    emp1Token = jwtService.sign({
      sub: emp1UserId.toString(),
      sid: emp1SessionId.toString(),
      type: 'access',
    });

    unauthorizedToken = jwtService.sign({
      sub: unauthorizedUserId.toString(),
      sid: unauthorizedSessionId.toString(),
      type: 'access',
    });

    reflector = new Reflector();
    getAllAndOverrideSpy = jest.spyOn(reflector, 'getAllAndOverride');

    mockAuditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
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
      findByReportingManager: jest.fn(
        (managerId: Types.ObjectId): Promise<EmployeeLean[]> => {
          const reports = Array.from(employeesStore.values()).filter(
            (e) =>
              e.reportingManagerId &&
              e.reportingManagerId.toString() === managerId.toString() &&
              !e.deletedAt,
          );
          return Promise.resolve(reports);
        },
      ),
    } as unknown as jest.Mocked<EmployeeRepository>;

    mockLeaveRequestRepo = {
      findList: jest.fn(
        (
          filter: Record<string, unknown> = {},
          page: number = 1,
          limit: number = 20,
          sort: Record<string, 1 | -1> = { createdAt: -1 },
        ): Promise<PaginatedResult<LeaveRequestLean>> => {
          let list = Array.from(leaveRequestsStore.values()).filter(
            (r) => !r.deletedAt,
          );

          // 1. employeeId filter (supports exact ObjectId or $in)
          if (filter.employeeId) {
            if (
              typeof filter.employeeId === 'object' &&
              filter.employeeId !== null &&
              '$in' in filter.employeeId
            ) {
              const inFilter = filter.employeeId as {
                $in: Array<Types.ObjectId | string>;
              };
              const allowed = inFilter.$in.map((id) => id.toString());
              list = list.filter((r) =>
                allowed.includes(r.employeeId.toString()),
              );
            } else {
              const targetId = (
                filter.employeeId as Types.ObjectId | string
              ).toString();
              list = list.filter((r) => r.employeeId.toString() === targetId);
            }
          }

          // 2. status filter
          if (filter.status) {
            list = list.filter((r) => r.status === filter.status);
          }

          // 3. leaveTypeId filter
          if (filter.leaveTypeId) {
            const targetLtId = (
              filter.leaveTypeId as Types.ObjectId | string
            ).toString();
            list = list.filter((r) => r.leaveTypeId.toString() === targetLtId);
          }

          // 4. year filter: filter['yearBreakdown.year']
          if (filter['yearBreakdown.year']) {
            const y = filter['yearBreakdown.year'] as number;
            list = list.filter((r) =>
              r.yearBreakdown.some((yb) => yb.year === y),
            );
          }

          // reportingManagerId filter
          if (filter.reportingManagerId) {
            const mId = (
              filter.reportingManagerId as Types.ObjectId | string
            ).toString();
            list = list.filter((r) => r.reportingManagerId?.toString() === mId);
          }

          // 5. startDate filter: { $lte: query.endDate } or { $gte: ... }
          if (filter.startDate && typeof filter.startDate === 'object') {
            const startObj = filter.startDate as Record<string, string>;
            if ('$gte' in startObj) {
              list = list.filter((r) => r.startDate >= startObj.$gte);
            }
            if ('$lte' in startObj) {
              list = list.filter((r) => r.startDate <= startObj.$lte);
            }
          }

          // 6. endDate filter: { $gte: query.startDate } or { $lte: ... }
          if (filter.endDate && typeof filter.endDate === 'object') {
            const endObj = filter.endDate as Record<string, string>;
            if ('$gte' in endObj) {
              list = list.filter((r) => r.endDate >= endObj.$gte);
            }
            if ('$lte' in endObj) {
              list = list.filter((r) => r.endDate <= endObj.$lte);
            }
          }

          // Sorting
          if (sort.createdAt === -1) {
            list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          } else if (sort.createdAt === 1) {
            list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          }

          const total = list.length;
          const skip = (page - 1) * limit;
          const paginatedData = list.slice(skip, skip + limit);

          return Promise.resolve({
            data: paginatedData,
            meta: buildPaginationMeta(total, page, limit),
          });
        },
      ),
      findPendingApprovalsByManager: jest.fn(
        (
          managerEmployeeId: Types.ObjectId | string,
          page: number = 1,
          limit: number = 20,
          filter: Record<string, unknown> = {},
        ): Promise<PaginatedResult<LeaveRequestLean>> => {
          const mId =
            typeof managerEmployeeId === 'string'
              ? new Types.ObjectId(managerEmployeeId)
              : managerEmployeeId;
          return mockLeaveRequestRepo.findList(
            {
              ...filter,
              reportingManagerId: mId,
              status: LeaveRequestStatus.PENDING,
            },
            page,
            limit,
            { createdAt: -1 },
          );
        },
      ),
    } as unknown as jest.Mocked<LeaveRequestRepository>;

    const mockConnection = {} as Connection;

    leavesService = new LeavesService(
      mockLeaveTypeRepo,
      {} as HolidayRepository,
      {} as LeaveBalanceRepository,
      mockLeaveRequestRepo,
      {} as LeaveTransactionRepository,
      {} as CompOffRepository,
      mockEmployeeRepo,
      {} as BranchRepository,
      {} as AttendanceRepository,
      {} as ShiftService,
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
    leaveRequestsStore.clear();
    jest.clearAllMocks();

    // Setup base employees in store
    createEmployee({
      _id: managerEmployeeId,
      userId: managerUserId,
      firstName: 'Manager',
      lastName: 'Leader',
      reportingManagerId: null,
    });

    createEmployee({
      _id: emp1Id,
      userId: emp1UserId,
      firstName: 'John',
      lastName: 'ReportOne',
      reportingManagerId: managerEmployeeId,
    });

    createEmployee({
      _id: emp2Id,
      userId: new Types.ObjectId(),
      firstName: 'Jane',
      lastName: 'ReportTwo',
      reportingManagerId: managerEmployeeId,
    });

    createEmployee({
      _id: unrelatedEmpId,
      userId: new Types.ObjectId(),
      firstName: 'Bob',
      lastName: 'Unrelated',
      reportingManagerId: null,
    });

    // Session repository mock
    mockSessionRepo.findActiveSessionByIdAndUserId.mockImplementation(
      (sId, uId) => {
        const sidStr = sId.toString();
        const uidStr = uId.toString();

        if (
          sidStr === hrSessionId.toString() &&
          uidStr === hrUserId.toString()
        ) {
          return Promise.resolve({
            _id: sId,
            userId: uId,
            isActive: true,
          } as unknown as SessionDocument);
        }

        if (
          sidStr === managerSessionId.toString() &&
          uidStr === managerUserId.toString()
        ) {
          return Promise.resolve({
            _id: sId,
            userId: uId,
            isActive: true,
          } as unknown as SessionDocument);
        }

        if (
          sidStr === emp1SessionId.toString() &&
          uidStr === emp1UserId.toString()
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

    // User repository mock
    mockUserRepo.findById.mockImplementation((uId) => {
      const uidStr = uId.toString();
      if (uidStr === hrUserId.toString()) {
        return Promise.resolve({
          _id: hrUserId,
          status: UserStatus.ACTIVE,
          roleIds: [hrRoleId],
        } as unknown as UserLean);
      }
      if (uidStr === managerUserId.toString()) {
        return Promise.resolve({
          _id: managerUserId,
          status: UserStatus.ACTIVE,
          roleIds: [managerRoleId],
        } as unknown as UserLean);
      }
      if (uidStr === emp1UserId.toString()) {
        return Promise.resolve({
          _id: emp1UserId,
          status: UserStatus.ACTIVE,
          roleIds: [emp1RoleId],
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

    // Default permissions mock:
    // HR role has LEAVES_VIEW
    // Manager and Emp1 have LEAVES_VIEW by default so they pass the controller guard
    mockAuthorizationService.hasPermissions.mockImplementation(
      (roleIds: Types.ObjectId[], perms: string[]) => {
        const allowedRoles = [
          hrRoleId.toString(),
          managerRoleId.toString(),
          emp1RoleId.toString(),
        ];
        if (
          roleIds.some((r) => allowedRoles.includes(r.toString())) &&
          perms.every(
            (p) =>
              p === PermissionKeys.LEAVE_REQUESTS_VIEW_TEAM ||
              p === PermissionKeys.LEAVE_REQUESTS_VIEW_PENDING_APPROVALS ||
              p === PermissionKeys.LEAVES_VIEW ||
              p === PermissionKeys.LEAVES_APPROVE,
          )
        ) {
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      },
    );

    // AuthorizationService.hasPermission for service-level checks:
    // HR user has LEAVES_VIEW = true
    // Normal manager/employee has LEAVES_VIEW = false (enforcing hierarchical scoping)
    mockAuthorizationService.hasPermission.mockImplementation(
      (actorId: Types.ObjectId | Types.ObjectId[], perm: string) => {
        if (Array.isArray(actorId)) return Promise.resolve(false);
        if (
          actorId.toString() === hrUserId.toString() &&
          (perm === PermissionKeys.LEAVE_REQUESTS_VIEW_TEAM ||
            perm === PermissionKeys.LEAVE_REQUESTS_VIEW ||
            perm === PermissionKeys.LEAVES_VIEW)
        ) {
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      },
    );
  });

  // ===========================================================================
  // TEST SUITE 1 — Default Pagination & Full List Structure (HR View)
  // ===========================================================================
  describe('Category 1: Default Pagination & Full Organization Listing (HR Scoping)', () => {
    it('should return paginated leave requests with default page 1, limit 20 and correct response metadata', async () => {
      const lt = createLeaveType({ name: 'Annual Leave', code: 'AL' });

      // Seed 3 requests
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        startDate: '2026-04-01',
        endDate: '2026-04-03',
        status: LeaveRequestStatus.APPROVED,
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
      });
      createLeaveRequest({
        employeeId: emp2Id,
        leaveTypeId: lt._id,
        startDate: '2026-05-10',
        endDate: '2026-05-12',
        status: LeaveRequestStatus.PENDING,
        createdAt: new Date('2026-03-05T10:00:00.000Z'),
      });
      createLeaveRequest({
        employeeId: unrelatedEmpId,
        leaveTypeId: lt._id,
        startDate: '2026-06-15',
        endDate: '2026-06-16',
        status: LeaveRequestStatus.REJECTED,
        createdAt: new Date('2026-03-10T10:00:00.000Z'),
      });

      const response = await executeListRequestsApi({}, hrToken);

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(3);
      expect(response.meta).toEqual({
        page: 1,
        limit: 20,
        total: 3,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      // Verify response structure of mapped data items
      const firstItem = response.data[0];
      expect(firstItem.id).toBeDefined();
      expect(firstItem.employeeId).toBeDefined();
      expect(firstItem.leaveTypeId).toBe(lt._id.toString());
      expect(firstItem.leaveTypeSnapshot).toBeDefined();
      expect(firstItem.leaveTypeSnapshot.name).toBe('Annual Leave');
      expect(firstItem.leaveTypeSnapshot.code).toBe('AL');
      expect(firstItem.startDate).toBeDefined();
      expect(firstItem.endDate).toBeDefined();
      expect(firstItem.totalDays).toBeGreaterThan(0);
      expect(typeof firstItem.isHalfDay).toBe('boolean');
      expect(firstItem.yearBreakdown).toBeInstanceOf(Array);
      expect(firstItem.status).toBeDefined();
    });

    it('should return empty list when no leave requests exist in the database', async () => {
      const response = await executeListRequestsApi({}, hrToken);

      expect(response.success).toBe(true);
      expect(response.data).toEqual([]);
      expect(response.meta).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });
  });

  // ===========================================================================
  // TEST SUITE 2 — Single Attribute Filtering
  // ===========================================================================
  describe('Category 2: Single Attribute Filters', () => {
    let ltAnnual: LeaveTypeLean;
    let ltSick: LeaveTypeLean;

    beforeEach(() => {
      ltAnnual = createLeaveType({ name: 'Annual Leave', code: 'AL' });
      ltSick = createLeaveType({ name: 'Sick Leave', code: 'SL' });

      // Request 1: Emp 1, Annual Leave, PENDING, 2026-03-01 to 2026-03-03
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: ltAnnual._id,
        startDate: '2026-03-01',
        endDate: '2026-03-03',
        status: LeaveRequestStatus.PENDING,
        yearBreakdown: [{ year: 2026, days: 3 }],
        createdAt: new Date('2026-02-01T10:00:00.000Z'),
      });

      // Request 2: Emp 1, Sick Leave, APPROVED, 2026-04-10 to 2026-04-12
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: ltSick._id,
        startDate: '2026-04-10',
        endDate: '2026-04-12',
        status: LeaveRequestStatus.APPROVED,
        yearBreakdown: [{ year: 2026, days: 3 }],
        createdAt: new Date('2026-02-05T10:00:00.000Z'),
      });

      // Request 3: Emp 2, Annual Leave, APPROVED, 2026-05-01 to 2026-05-05
      createLeaveRequest({
        employeeId: emp2Id,
        leaveTypeId: ltAnnual._id,
        startDate: '2026-05-01',
        endDate: '2026-05-05',
        status: LeaveRequestStatus.APPROVED,
        yearBreakdown: [{ year: 2026, days: 5 }],
        createdAt: new Date('2026-02-10T10:00:00.000Z'),
      });

      // Request 4: Emp 2, Sick Leave, REJECTED, 2026-06-20 to 2026-06-21
      createLeaveRequest({
        employeeId: emp2Id,
        leaveTypeId: ltSick._id,
        startDate: '2026-06-20',
        endDate: '2026-06-21',
        status: LeaveRequestStatus.REJECTED,
        yearBreakdown: [{ year: 2026, days: 2 }],
        createdAt: new Date('2026-02-15T10:00:00.000Z'),
      });

      // Request 5: Unrelated Emp, Annual Leave, APPROVED, 2026-12-28 to 2027-01-04 (Multi-Year)
      createLeaveRequest({
        employeeId: unrelatedEmpId,
        leaveTypeId: ltAnnual._id,
        startDate: '2026-12-28',
        endDate: '2027-01-04',
        status: LeaveRequestStatus.APPROVED,
        yearBreakdown: [
          { year: 2026, days: 4 },
          { year: 2027, days: 2 },
        ],
        createdAt: new Date('2026-12-01T10:00:00.000Z'),
      });
    });

    it('should filter strictly by employeeId', async () => {
      const response = await executeListRequestsApi(
        { employeeId: emp1Id.toString() },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
      expect(
        response.data.every((r) => r.employeeId === emp1Id.toString()),
      ).toBe(true);
    });

    it('should filter strictly by status', async () => {
      const responsePending = await executeListRequestsApi(
        { status: LeaveRequestStatus.PENDING },
        hrToken,
      );
      expect(responsePending.success).toBe(true);
      expect(responsePending.data).toHaveLength(1);
      expect(responsePending.data[0].status).toBe(LeaveRequestStatus.PENDING);

      const responseApproved = await executeListRequestsApi(
        { status: LeaveRequestStatus.APPROVED },
        hrToken,
      );
      expect(responseApproved.success).toBe(true);
      expect(responseApproved.data).toHaveLength(3);
      expect(
        responseApproved.data.every(
          (r) => r.status === (LeaveRequestStatus.APPROVED as string),
        ),
      ).toBe(true);
    });

    it('should filter strictly by leaveTypeId', async () => {
      const responseSick = await executeListRequestsApi(
        { leaveTypeId: ltSick._id.toString() },
        hrToken,
      );

      expect(responseSick.success).toBe(true);
      expect(responseSick.data).toHaveLength(2);
      expect(
        responseSick.data.every((r) => r.leaveTypeId === ltSick._id.toString()),
      ).toBe(true);
    });

    it('should filter strictly by calendar year matching yearBreakdown', async () => {
      // 2027 only matches Request 5 (crossover leave)
      const response2027 = await executeListRequestsApi(
        { year: 2027 },
        hrToken,
      );

      expect(response2027.success).toBe(true);
      expect(response2027.data).toHaveLength(1);
      expect(response2027.data[0].employeeId).toBe(unrelatedEmpId.toString());
      expect(response2027.data[0].yearBreakdown).toEqual(
        expect.arrayContaining([{ year: 2027, days: 2 }]),
      );

      // 2026 matches all 5 requests
      const response2026 = await executeListRequestsApi(
        { year: 2026 },
        hrToken,
      );
      expect(response2026.data).toHaveLength(5);
    });

    it('should filter by startDate (requests active on or after startDate)', async () => {
      // Requests ending on or after 2026-05-01 -> Request 3, 4, 5 (3 requests)
      const response = await executeListRequestsApi(
        { startDate: '2026-05-01' },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(3);
      expect(response.data.every((r) => r.endDate >= '2026-05-01')).toBe(true);
    });

    it('should filter by endDate (requests active on or before endDate)', async () => {
      // Requests starting on or before 2026-04-30 -> Request 1, 2 (2 requests)
      const response = await executeListRequestsApi(
        { endDate: '2026-04-30' },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
      expect(response.data.every((r) => r.startDate <= '2026-04-30')).toBe(
        true,
      );
    });

    it('should filter by date range with interval overlap (both startDate and endDate)', async () => {
      // Date range 2026-04-01 to 2026-05-31 -> Request 2 (Apr 10-12) and Request 3 (May 01-05)
      const response = await executeListRequestsApi(
        { startDate: '2026-04-01', endDate: '2026-05-31' },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
      expect(
        response.data.every(
          (r) => r.startDate <= '2026-05-31' && r.endDate >= '2026-04-01',
        ),
      ).toBe(true);
    });
  });

  // ===========================================================================
  // TEST SUITE 3 — Combined Multi-Attribute Filtering
  // ===========================================================================
  describe('Category 3: Combined Multi-Attribute Filters', () => {
    let ltAnnual: LeaveTypeLean;
    let ltSick: LeaveTypeLean;

    beforeEach(() => {
      ltAnnual = createLeaveType({ name: 'Annual', code: 'ANN' });
      ltSick = createLeaveType({ name: 'Sick', code: 'SCK' });

      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: ltAnnual._id,
        startDate: '2026-03-01',
        endDate: '2026-03-05',
        status: LeaveRequestStatus.APPROVED,
        yearBreakdown: [{ year: 2026, days: 5 }],
      });

      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: ltSick._id,
        startDate: '2026-03-10',
        endDate: '2026-03-12',
        status: LeaveRequestStatus.PENDING,
        yearBreakdown: [{ year: 2026, days: 3 }],
      });

      createLeaveRequest({
        employeeId: emp2Id,
        leaveTypeId: ltAnnual._id,
        startDate: '2026-04-01',
        endDate: '2026-04-04',
        status: LeaveRequestStatus.APPROVED,
        yearBreakdown: [{ year: 2026, days: 4 }],
      });
    });

    it('should filter by employeeId AND status simultaneously', async () => {
      const response = await executeListRequestsApi(
        {
          employeeId: emp1Id.toString(),
          status: LeaveRequestStatus.APPROVED,
        },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].employeeId).toBe(emp1Id.toString());
      expect(response.data[0].status).toBe(LeaveRequestStatus.APPROVED);
    });

    it('should filter by leaveTypeId, status, AND year simultaneously', async () => {
      const response = await executeListRequestsApi(
        {
          leaveTypeId: ltAnnual._id.toString(),
          status: LeaveRequestStatus.APPROVED,
          year: 2026,
        },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
      expect(
        response.data.every(
          (r) =>
            r.leaveTypeId === ltAnnual._id.toString() &&
            r.status === (LeaveRequestStatus.APPROVED as string),
        ),
      ).toBe(true);
    });

    it('should return empty results when combined filters produce zero matches', async () => {
      const response = await executeListRequestsApi(
        {
          employeeId: emp1Id.toString(),
          leaveTypeId: ltSick._id.toString(),
          status: LeaveRequestStatus.APPROVED, // Emp1 only has PENDING sick leave
        },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toEqual([]);
      expect(response.meta.total).toBe(0);
      expect(response.meta.totalPages).toBe(0);
    });
  });

  // ===========================================================================
  // TEST SUITE 4 — Pagination Mechanics, Limits, and Boundaries
  // ===========================================================================
  describe('Category 4: Pagination Mechanics, Page Limits, and Boundaries', () => {
    beforeEach(() => {
      const lt = createLeaveType();
      // Seed 7 requests with staggered creation times
      for (let i = 1; i <= 7; i++) {
        createLeaveRequest({
          employeeId: emp1Id,
          leaveTypeId: lt._id,
          reason: `Request #${i}`,
          createdAt: new Date(`2026-01-0${i}T10:00:00.000Z`),
        });
      }
    });

    it('should paginate results with custom page and limit (page 1, limit 2)', async () => {
      const response = await executeListRequestsApi(
        { page: 1, limit: 2 },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
      expect(response.meta).toEqual({
        page: 1,
        limit: 2,
        total: 7,
        totalPages: 4,
        hasNextPage: true,
        hasPreviousPage: false,
      });
      // Newest first -> Request #7, Request #6
      expect(response.data[0].reason).toBe('Request #7');
      expect(response.data[1].reason).toBe('Request #6');
    });

    it('should fetch intermediate page with correct previous and next flags (page 2, limit 2)', async () => {
      const response = await executeListRequestsApi(
        { page: 2, limit: 2 },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
      expect(response.meta).toEqual({
        page: 2,
        limit: 2,
        total: 7,
        totalPages: 4,
        hasNextPage: true,
        hasPreviousPage: true,
      });
      expect(response.data[0].reason).toBe('Request #5');
      expect(response.data[1].reason).toBe('Request #4');
    });

    it('should fetch the final page with hasNextPage: false (page 4, limit 2)', async () => {
      const response = await executeListRequestsApi(
        { page: 4, limit: 2 },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1); // 7 % 2 = 1 remaining item
      expect(response.meta).toEqual({
        page: 4,
        limit: 2,
        total: 7,
        totalPages: 4,
        hasNextPage: false,
        hasPreviousPage: true,
      });
      expect(response.data[0].reason).toBe('Request #1');
    });

    it('should return empty data for an out-of-bounds page (page 99)', async () => {
      const response = await executeListRequestsApi(
        { page: 99, limit: 20 },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toEqual([]);
      expect(response.meta).toEqual({
        page: 99,
        limit: 20,
        total: 7,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });

    it('should respect maximum allowed limit boundary (limit: 100)', async () => {
      const response = await executeListRequestsApi(
        { page: 1, limit: 100 },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(7);
      expect(response.meta.limit).toBe(100);
      expect(response.meta.hasNextPage).toBe(false);
    });
  });

  // ===========================================================================
  // TEST SUITE 5 — Default Sorting
  // ===========================================================================
  describe('Category 5: Default Sorting Order', () => {
    it('should sort results strictly in descending order of creation date (newest first)', async () => {
      const lt = createLeaveType();

      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        reason: 'Oldest Request',
        createdAt: new Date('2026-01-01T10:00:00.000Z'),
      });
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        reason: 'Middle Request',
        createdAt: new Date('2026-01-15T10:00:00.000Z'),
      });
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        reason: 'Newest Request',
        createdAt: new Date('2026-02-01T10:00:00.000Z'),
      });

      const response = await executeListRequestsApi({}, hrToken);

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(3);
      expect(response.data[0].reason).toBe('Newest Request');
      expect(response.data[1].reason).toBe('Middle Request');
      expect(response.data[2].reason).toBe('Oldest Request');

      // Verify that findList was called with sort: { createdAt: -1 }
      expect(mockLeaveRequestRepo.findList).toHaveBeenCalledWith(
        expect.anything(),
        1,
        20,
        { createdAt: -1 },
      );
    });
  });

  // ===========================================================================
  // TEST SUITE 6 — Query Parameter Validation (ValidationPipe)
  // ===========================================================================
  describe('Category 6: Query Parameter Validation (ValidationPipe)', () => {
    it('should reject non-MongoId employeeId with 400 Bad Request', async () => {
      await expect(
        executeListRequestsApi({ employeeId: 'not-a-mongo-id' }, hrToken),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should reject non-MongoId leaveTypeId with 400 Bad Request', async () => {
      await expect(
        executeListRequestsApi({ leaveTypeId: '123-invalid' }, hrToken),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should reject invalid status enum with 400 Bad Request', async () => {
      await expect(
        executeListRequestsApi({ status: 'INVALID_STATUS_VALUE' }, hrToken),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should reject invalid startDate calendar format with 400 Bad Request', async () => {
      const invalidFormats = ['2026/10/01', '01-10-2026', '2026-1-1', 'today'];
      for (const date of invalidFormats) {
        await expect(
          executeListRequestsApi({ startDate: date }, hrToken),
        ).rejects.toMatchObject({
          statusCode: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_ERROR,
        });
      }
    });

    it('should reject invalid endDate calendar format with 400 Bad Request', async () => {
      await expect(
        executeListRequestsApi({ endDate: '31.10.2026' }, hrToken),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should reject when startDate is later than endDate with 400 Bad Request', async () => {
      await expect(
        executeListRequestsApi(
          { startDate: '2026-11-01', endDate: '2026-10-01' },
          hrToken,
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should reject year outside the 2000-2100 boundary with 400 Bad Request', async () => {
      await expect(
        executeListRequestsApi({ year: 1999 }, hrToken),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      await expect(
        executeListRequestsApi({ year: 2101 }, hrToken),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should reject page less than 1 with 400 Bad Request', async () => {
      await expect(
        executeListRequestsApi({ page: 0 }, hrToken),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      await expect(
        executeListRequestsApi({ page: -3 }, hrToken),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should reject limit less than 1 or greater than 100 with 400 Bad Request', async () => {
      await expect(
        executeListRequestsApi({ limit: 0 }, hrToken),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });

      await expect(
        executeListRequestsApi({ limit: 101 }, hrToken),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should reject non-whitelisted query parameters with 400 Bad Request', async () => {
      await expect(
        executeListRequestsApi({ maliciousParam: 'inject-sql' }, hrToken),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  // ===========================================================================
  // TEST SUITE 7 — Authentication & RBAC Guard Enforcement
  // ===========================================================================
  describe('Category 7: Authentication & RBAC Guard Enforcement', () => {
    it('should return 401 Unauthorized when Authorization token is missing', async () => {
      getAllAndOverrideSpy.mockReturnValue(false);
      const ctx = createMockContext(undefined, {});

      await expect(jwtAuthGuard.canActivate(ctx)).rejects.toMatchObject({
        statusCode: HttpStatus.UNAUTHORIZED,
        code: ErrorCode.UNAUTHORIZED,
      });
    });

    it('should return 401 Unauthorized when session is inactive or terminated', async () => {
      getAllAndOverrideSpy.mockReturnValue(false);
      mockSessionRepo.findActiveSessionByIdAndUserId.mockResolvedValueOnce(
        null,
      );

      const ctx = createMockContext(hrToken, {});
      await expect(jwtAuthGuard.canActivate(ctx)).rejects.toMatchObject({
        statusCode: HttpStatus.UNAUTHORIZED,
        code: ErrorCode.UNAUTHORIZED,
      });
    });

    it('should return 403 Forbidden when user lacks LEAVES_VIEW permission', async () => {
      getAllAndOverrideSpy.mockReturnValue(false);
      const ctx = createMockContext(unauthorizedToken, {});
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([
        PermissionKeys.LEAVE_REQUESTS_VIEW_TEAM,
      ]);
      await expect(permissionsGuard.canActivate(ctx)).rejects.toMatchObject({
        statusCode: HttpStatus.FORBIDDEN,
        code: ErrorCode.FORBIDDEN,
      });
    });
  });

  // ===========================================================================
  // TEST SUITE 8 — Data Isolation & Hierarchical Manager Scoping
  // ===========================================================================
  describe('Category 8: Data Isolation & Hierarchical Manager Scoping', () => {
    let lt: LeaveTypeLean;

    beforeEach(() => {
      lt = createLeaveType();

      // Manager's own request
      createLeaveRequest({
        employeeId: managerEmployeeId,
        leaveTypeId: lt._id,
        reason: 'Manager personal leave',
      });

      // Direct report 1's request
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        reason: 'Emp1 direct report leave',
      });

      // Direct report 2's request
      createLeaveRequest({
        employeeId: emp2Id,
        leaveTypeId: lt._id,
        reason: 'Emp2 direct report leave',
      });

      // Unrelated employee's request
      createLeaveRequest({
        employeeId: unrelatedEmpId,
        leaveTypeId: lt._id,
        reason: 'Unrelated employee leave',
      });
    });

    it('should auto-scope to self and direct reports when a manager lists requests without employeeId', async () => {
      const response = await executeListRequestsApi({}, managerToken);

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(3);

      const returnedEmployeeIds = response.data.map((r) => r.employeeId);
      expect(returnedEmployeeIds).toContain(managerEmployeeId.toString());
      expect(returnedEmployeeIds).toContain(emp1Id.toString());
      expect(returnedEmployeeIds).toContain(emp2Id.toString());
      expect(returnedEmployeeIds).not.toContain(unrelatedEmpId.toString());
    });

    it('should allow manager to view leave requests of their direct report', async () => {
      const response = await executeListRequestsApi(
        { employeeId: emp1Id.toString() },
        managerToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].employeeId).toBe(emp1Id.toString());
    });

    it('should allow employee to view their own leave requests', async () => {
      const response = await executeListRequestsApi(
        { employeeId: emp1Id.toString() },
        emp1Token,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].employeeId).toBe(emp1Id.toString());
    });

    it('should forbid manager from querying an unrelated employee who is not their direct report', async () => {
      await expect(
        executeListRequestsApi(
          { employeeId: unrelatedEmpId.toString() },
          managerToken,
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.FORBIDDEN,
        code: ErrorCode.FORBIDDEN,
        message:
          'Insufficient permissions to view leave requests for this employee',
      });
    });

    it('should forbid non-HR user with no employee document from listing requests', async () => {
      // User with valid session and token, but no employee document in employeeRepo
      const noEmpUserId = new Types.ObjectId();
      const noEmpSessionId = new Types.ObjectId();
      const noEmpRoleId = new Types.ObjectId();

      const tokenNoEmp = jwtService.sign({
        sub: noEmpUserId.toString(),
        sid: noEmpSessionId.toString(),
        type: 'access',
      });

      mockSessionRepo.findActiveSessionByIdAndUserId.mockResolvedValueOnce({
        _id: noEmpSessionId,
        userId: noEmpUserId,
        isActive: true,
      } as unknown as SessionDocument);

      mockUserRepo.findById.mockResolvedValueOnce({
        _id: noEmpUserId,
        status: UserStatus.ACTIVE,
        roleIds: [noEmpRoleId],
      } as unknown as UserLean);

      mockAuthorizationService.hasPermissions.mockResolvedValueOnce(true);
      mockAuthorizationService.hasPermission.mockResolvedValueOnce(false); // no global view permission

      await expect(
        executeListRequestsApi({}, tokenNoEmp),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.FORBIDDEN,
        code: ErrorCode.FORBIDDEN,
        message: 'Insufficient permissions to view leave requests',
      });
    });
  });

  // ===========================================================================
  // TEST SUITE 9 — Edge Cases & Read-Only State Integrity
  // ===========================================================================
  describe('Category 9: Edge Cases & Read-Only State Integrity', () => {
    it('should strictly exclude soft-deleted leave requests from listing', async () => {
      const lt = createLeaveType();

      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        reason: 'Active Request',
        deletedAt: null,
      });

      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        reason: 'Soft Deleted Request',
        deletedAt: new Date(),
      });

      const response = await executeListRequestsApi({}, hrToken);

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].reason).toBe('Active Request');
    });

    it('should ensure GET requests cause zero database mutations on repositories and stores', async () => {
      const lt = createLeaveType();
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        reason: 'Immutable Data Check',
      });

      const initialCount = leaveRequestsStore.size;
      const initialEmployeeCount = employeesStore.size;
      const initialLeaveTypesCount = leaveTypesStore.size;

      await executeListRequestsApi({}, hrToken);

      expect(leaveRequestsStore.size).toBe(initialCount);
      expect(employeesStore.size).toBe(initialEmployeeCount);
      expect(leaveTypesStore.size).toBe(initialLeaveTypesCount);
    });
  });

  // ===========================================================================
  // TEST SUITE 10 — Date Range Interval Overlap Edge Cases
  // ===========================================================================
  describe('Category 10: Date Range Interval Overlap Edge Cases', () => {
    let lt: LeaveTypeLean;

    beforeEach(() => {
      lt = createLeaveType({ name: 'Standard Leave', code: 'STD' });

      // Case 1: Overlaps start boundary (starts before, ends inside window)
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        startDate: '2026-04-20',
        endDate: '2026-05-10',
        reason: 'Overlaps Start Boundary',
      });

      // Case 2: Overlaps end boundary (starts inside, ends after window)
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        startDate: '2026-05-20',
        endDate: '2026-06-10',
        reason: 'Overlaps End Boundary',
      });

      // Case 3: Spans entire window (starts before, ends after window)
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        startDate: '2026-04-15',
        endDate: '2026-06-15',
        reason: 'Spans Entire Window',
      });

      // Case 4: Fully contained inside window
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        startDate: '2026-05-05',
        endDate: '2026-05-15',
        reason: 'Fully Contained',
      });

      // Case 5: Strictly before window (must NOT be returned)
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        startDate: '2026-04-01',
        endDate: '2026-04-25',
        reason: 'Strictly Before Window',
      });

      // Case 6: Strictly after window (must NOT be returned)
      createLeaveRequest({
        employeeId: emp1Id,
        leaveTypeId: lt._id,
        startDate: '2026-06-05',
        endDate: '2026-06-25',
        reason: 'Strictly After Window',
      });
    });

    it('should return all overlapping leave requests across boundaries and exclude non-overlapping requests', async () => {
      // Query window: 2026-05-01 to 2026-05-31
      const response = await executeListRequestsApi(
        { startDate: '2026-05-01', endDate: '2026-05-31' },
        hrToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(4);

      const returnedReasons = response.data.map((r) => r.reason);
      expect(returnedReasons).toContain('Overlaps Start Boundary');
      expect(returnedReasons).toContain('Overlaps End Boundary');
      expect(returnedReasons).toContain('Spans Entire Window');
      expect(returnedReasons).toContain('Fully Contained');
      expect(returnedReasons).not.toContain('Strictly Before Window');
      expect(returnedReasons).not.toContain('Strictly After Window');
    });
  });

  // ===========================================================================
  // TEST SUITE 11 — Manager Pending Approvals Queue (GET /requests/approvals/pending)
  // ===========================================================================
  describe('Category 11: Manager Pending Approvals Queue', () => {
    let ltAnnual: LeaveTypeLean;
    let ltSick: LeaveTypeLean;

    beforeEach(() => {
      ltAnnual = createLeaveType({ name: 'Annual Leave', code: 'AL' });
      ltSick = createLeaveType({ name: 'Sick Leave', code: 'SL' });

      // Request 1: Emp1 (direct report), PENDING, AL, 2026-07-01 to 2026-07-05
      createLeaveRequest({
        employeeId: emp1Id,
        reportingManagerId: managerEmployeeId,
        leaveTypeId: ltAnnual._id,
        startDate: '2026-07-01',
        endDate: '2026-07-05',
        status: LeaveRequestStatus.PENDING,
        yearBreakdown: [{ year: 2026, days: 5 }],
        reason: 'Emp1 AL Pending',
      });

      // Request 2: Emp2 (direct report), PENDING, SL, 2026-07-10 to 2026-07-12
      createLeaveRequest({
        employeeId: emp2Id,
        reportingManagerId: managerEmployeeId,
        leaveTypeId: ltSick._id,
        startDate: '2026-07-10',
        endDate: '2026-07-12',
        status: LeaveRequestStatus.PENDING,
        yearBreakdown: [{ year: 2026, days: 3 }],
        reason: 'Emp2 SL Pending',
      });

      // Request 3: Emp1 (direct report), ALREADY APPROVED (must NOT be returned)
      createLeaveRequest({
        employeeId: emp1Id,
        reportingManagerId: managerEmployeeId,
        leaveTypeId: ltAnnual._id,
        startDate: '2026-08-01',
        endDate: '2026-08-03',
        status: LeaveRequestStatus.APPROVED,
        yearBreakdown: [{ year: 2026, days: 3 }],
        reason: 'Emp1 AL Approved',
      });

      // Request 4: Unrelated Emp, PENDING, different manager (must NOT be returned)
      createLeaveRequest({
        employeeId: unrelatedEmpId,
        reportingManagerId: new Types.ObjectId(),
        leaveTypeId: ltAnnual._id,
        startDate: '2026-07-01',
        endDate: '2026-07-05',
        status: LeaveRequestStatus.PENDING,
        yearBreakdown: [{ year: 2026, days: 5 }],
        reason: 'Unrelated Emp Pending',
      });
    });

    it('should list all pending approvals for direct reports and exclude approved/other manager requests', async () => {
      const response = await executeGetPendingApprovalsApi({}, managerToken);

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
      expect(
        response.data.every(
          (r) => r.status === (LeaveRequestStatus.PENDING as string),
        ),
      ).toBe(true);
      expect(
        response.data.every(
          (r) => r.reportingManagerId === managerEmployeeId.toString(),
        ),
      ).toBe(true);
    });

    it('should filter pending approvals by specific employeeId', async () => {
      const response = await executeGetPendingApprovalsApi(
        { employeeId: emp1Id.toString() },
        managerToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].employeeId).toBe(emp1Id.toString());
      expect(response.data[0].reason).toBe('Emp1 AL Pending');
    });

    it('should filter pending approvals by leaveTypeId', async () => {
      const response = await executeGetPendingApprovalsApi(
        { leaveTypeId: ltSick._id.toString() },
        managerToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].leaveTypeId).toBe(ltSick._id.toString());
      expect(response.data[0].reason).toBe('Emp2 SL Pending');
    });

    it('should filter pending approvals by date range with interval overlap', async () => {
      // Window covering only Request 1 (Jul 01 - Jul 06)
      const response = await executeGetPendingApprovalsApi(
        { startDate: '2026-07-01', endDate: '2026-07-06' },
        managerToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].reason).toBe('Emp1 AL Pending');
    });

    it('should filter pending approvals by calendar year', async () => {
      const response = await executeGetPendingApprovalsApi(
        { year: 2026 },
        managerToken,
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);

      const response2025 = await executeGetPendingApprovalsApi(
        { year: 2025 },
        managerToken,
      );
      expect(response2025.data).toHaveLength(0);
    });

    it('should reject pending approvals query when startDate is later than endDate with 400 Bad Request', async () => {
      await expect(
        executeGetPendingApprovalsApi(
          { startDate: '2026-11-01', endDate: '2026-10-01' },
          managerToken,
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should reject unwhitelisted query parameters (such as status) with 400 Bad Request', async () => {
      await expect(
        executeGetPendingApprovalsApi(
          { status: LeaveRequestStatus.APPROVED },
          managerToken,
        ),
      ).rejects.toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });
});

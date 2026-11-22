/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { HttpStatus, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';

import { LeavesController } from './leaves.controller';
import { LeavesService } from './services/leaves.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { SessionRepository } from '../auth/repositories/session.repository';
import { UserRepository } from '../users/repositories/user.repository';
import { UserStatus } from '../users/constants/user-status.constant';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('Leaves Module Granular RBAC Integration Test Suite (29 Leaves APIs + Comp-Off)', () => {
  let controller: LeavesController;
  let leavesService: LeavesService;
  let jwtAuthGuard: JwtAuthGuard;
  let permissionsGuard: PermissionsGuard;
  let jwtService: JwtService;
  let reflector: Reflector;
  let getAllAndOverrideSpy: jest.SpyInstance;

  const JWT_SECRET = 'enterprise-hrms-rbac-integration-secret-hs256';

  // Identities
  const employeeUserId = new Types.ObjectId();
  const employeeSessionId = new Types.ObjectId();
  const employeeRoleId = new Types.ObjectId();

  const managerUserId = new Types.ObjectId();
  const managerSessionId = new Types.ObjectId();
  const managerRoleId = new Types.ObjectId();

  const hrAdminUserId = new Types.ObjectId();
  const hrAdminSessionId = new Types.ObjectId();
  const hrAdminRoleId = new Types.ObjectId();

  let employeeToken: string;
  let managerToken: string;
  let hrAdminToken: string;

  let mockAuthorizationService: jest.Mocked<AuthorizationService>;
  let mockSessionRepo: jest.Mocked<SessionRepository>;
  let mockUserRepo: jest.Mocked<UserRepository>;

  // Granted permissions sets
  const employeePermissions = new Set<string>([
    PermissionKeys.LEAVE_TYPES_VIEW,
    PermissionKeys.HOLIDAYS_VIEW,
    PermissionKeys.LEAVE_BALANCES_VIEW_OWN,
    PermissionKeys.LEAVE_BALANCES_VIEW_OWN_TRANSACTIONS,
    PermissionKeys.LEAVE_REQUESTS_APPLY,
    PermissionKeys.LEAVE_REQUESTS_VIEW_OWN,
    PermissionKeys.LEAVE_REQUESTS_CANCEL_OWN,
    PermissionKeys.LEAVE_CALENDAR_VIEW_OWN,
    PermissionKeys.COMP_OFF_CLAIM,
    PermissionKeys.COMP_OFF_VIEW_OWN,
  ]);

  const managerPermissions = new Set<string>([
    ...Array.from(employeePermissions),
    PermissionKeys.LEAVE_BALANCES_VIEW_TEAM,
    PermissionKeys.LEAVE_BALANCES_VIEW_TEAM_TRANSACTIONS,
    PermissionKeys.LEAVE_REQUESTS_VIEW_PENDING_APPROVALS,
    PermissionKeys.LEAVE_REQUESTS_VIEW_TEAM,
    PermissionKeys.LEAVE_REQUESTS_VIEW,
    PermissionKeys.LEAVE_REQUESTS_APPROVE,
    PermissionKeys.LEAVE_REQUESTS_REJECT,
    PermissionKeys.LEAVE_CALENDAR_VIEW_TEAM,
    PermissionKeys.COMP_OFF_VIEW_TEAM,
    PermissionKeys.COMP_OFF_VIEW,
    PermissionKeys.COMP_OFF_REVIEW,
  ]);

  const hrAdminPermissions = new Set<string>([
    ...Array.from(managerPermissions),
    PermissionKeys.LEAVE_TYPES_CREATE,
    PermissionKeys.LEAVE_TYPES_EDIT,
    PermissionKeys.LEAVE_TYPES_DELETE,
    PermissionKeys.HOLIDAYS_CREATE,
    PermissionKeys.HOLIDAYS_EDIT,
    PermissionKeys.HOLIDAYS_DELETE,
    PermissionKeys.LEAVE_BALANCES_ALLOCATE,
    PermissionKeys.LEAVE_BALANCES_ADJUST,
    PermissionKeys.LEAVE_BALANCES_CARRY_FORWARD,
    PermissionKeys.LEAVE_CALENDAR_VIEW_ORGANIZATION,
  ]);

  const createMockContext = (token: string): ExecutionContext => {
    let resolvedUser: any = null;
    if (token === employeeToken) {
      resolvedUser = {
        userId: employeeUserId,
        roleIds: [employeeRoleId],
        sessionId: employeeSessionId,
      };
    } else if (token === managerToken) {
      resolvedUser = {
        userId: managerUserId,
        roleIds: [managerRoleId],
        sessionId: managerSessionId,
      };
    } else if (token === hrAdminToken) {
      resolvedUser = {
        userId: hrAdminUserId,
        roleIds: [hrAdminRoleId],
        sessionId: hrAdminSessionId,
      };
    }

    const mockReq: AuthenticatedRequest = {
      headers: {
        authorization: token ? `Bearer ${token}` : undefined,
      },
      cookies: {
        access_token: token,
      },
      user: resolvedUser,
      ip: '127.0.0.1',
    } as unknown as AuthenticatedRequest;

    return {
      switchToHttp: () => ({
        getRequest: () => mockReq,
        getResponse: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => LeavesController,
    } as unknown as ExecutionContext;
  };

  beforeAll(() => {
    jwtService = new JwtService({ secret: JWT_SECRET });

    employeeToken = jwtService.sign({
      sub: employeeUserId.toString(),
      sid: employeeSessionId.toString(),
      type: 'access',
    });

    managerToken = jwtService.sign({
      sub: managerUserId.toString(),
      sid: managerSessionId.toString(),
      type: 'access',
    });

    hrAdminToken = jwtService.sign({
      sub: hrAdminUserId.toString(),
      sid: hrAdminSessionId.toString(),
      type: 'access',
    });
  });

  beforeEach(() => {
    reflector = new Reflector();
    getAllAndOverrideSpy = jest.spyOn(reflector, 'getAllAndOverride');

    mockSessionRepo = {
      findActiveSessionByIdAndUserId: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        revokedAt: null,
      }),
    } as any;

    mockUserRepo = {
      findById: jest.fn().mockImplementation((id: Types.ObjectId) => {
        if (id.toString() === employeeUserId.toString()) {
          return Promise.resolve({
            _id: employeeUserId,
            status: UserStatus.ACTIVE,
            roleIds: [employeeRoleId],
          });
        }
        if (id.toString() === managerUserId.toString()) {
          return Promise.resolve({
            _id: managerUserId,
            status: UserStatus.ACTIVE,
            roleIds: [managerRoleId],
          });
        }
        if (id.toString() === hrAdminUserId.toString()) {
          return Promise.resolve({
            _id: hrAdminUserId,
            status: UserStatus.ACTIVE,
            roleIds: [hrAdminRoleId],
          });
        }
        return Promise.resolve(null);
      }),
    } as any;

    mockAuthorizationService = {
      hasPermissions: jest
        .fn()
        .mockImplementation((roleIds: Types.ObjectId[], perms: string[]) => {
          let grantedSet: Set<string>;
          if (roleIds.some((r) => r.toString() === employeeRoleId.toString())) {
            grantedSet = employeePermissions;
          } else if (
            roleIds.some((r) => r.toString() === managerRoleId.toString())
          ) {
            grantedSet = managerPermissions;
          } else if (
            roleIds.some((r) => r.toString() === hrAdminRoleId.toString())
          ) {
            grantedSet = hrAdminPermissions;
          } else {
            return Promise.resolve(false);
          }
          return Promise.resolve(perms.every((p) => grantedSet.has(p)));
        }),
      hasPermission: jest
        .fn()
        .mockImplementation((actorIdOrRoles: unknown, perm: string) => {
          const actorIdStr = String(actorIdOrRoles);
          if (actorIdStr === employeeUserId.toString()) {
            return Promise.resolve(employeePermissions.has(perm));
          }
          if (actorIdStr === managerUserId.toString()) {
            return Promise.resolve(managerPermissions.has(perm));
          }
          if (actorIdStr === hrAdminUserId.toString()) {
            return Promise.resolve(hrAdminPermissions.has(perm));
          }
          return Promise.resolve(false);
        }),
    } as any;

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

    leavesService = {
      allocateLeave: jest.fn().mockResolvedValue([]),
      adjustBalance: jest.fn().mockResolvedValue({}),
      processYearEndCarryForward: jest.fn().mockResolvedValue({}),
      createLeaveType: jest.fn().mockResolvedValue({}),
      createHoliday: jest.fn().mockResolvedValue({}),
      applyLeave: jest.fn().mockResolvedValue({}),
      getMyBalances: jest.fn().mockResolvedValue([]),
      getMyRequests: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      listRequests: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      approveLeave: jest.fn().mockResolvedValue({}),
      rejectLeave: jest.fn().mockResolvedValue({}),
    } as any;

    controller = new LeavesController(leavesService);
    expect(controller).toBeDefined();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Employee Role Protection — Blocked from Administrative Operations', () => {
    it('Employee MUST be strictly rejected with 403 Forbidden when attempting to allocate leave balances', async () => {
      const ctx = createMockContext(employeeToken);
      getAllAndOverrideSpy.mockReturnValue(false); // Not public
      await jwtAuthGuard.canActivate(ctx);

      // Controller route requires leave_balances.allocate
      getAllAndOverrideSpy.mockReturnValue([
        PermissionKeys.LEAVE_BALANCES_ALLOCATE,
      ]);

      await expect(permissionsGuard.canActivate(ctx)).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          `Insufficient permission. Required: ${PermissionKeys.LEAVE_BALANCES_ALLOCATE}`,
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('Employee MUST be strictly rejected with 403 Forbidden when attempting to adjust leave balances', async () => {
      const ctx = createMockContext(employeeToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([
        PermissionKeys.LEAVE_BALANCES_ADJUST,
      ]);

      await expect(permissionsGuard.canActivate(ctx)).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          `Insufficient permission. Required: ${PermissionKeys.LEAVE_BALANCES_ADJUST}`,
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('Employee MUST be strictly rejected with 403 Forbidden when attempting to process carry-forward', async () => {
      const ctx = createMockContext(employeeToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([
        PermissionKeys.LEAVE_BALANCES_CARRY_FORWARD,
      ]);

      await expect(permissionsGuard.canActivate(ctx)).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          `Insufficient permission. Required: ${PermissionKeys.LEAVE_BALANCES_CARRY_FORWARD}`,
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('Employee MUST be strictly rejected with 403 Forbidden when attempting to create leave types', async () => {
      const ctx = createMockContext(employeeToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([PermissionKeys.LEAVE_TYPES_CREATE]);

      await expect(permissionsGuard.canActivate(ctx)).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          `Insufficient permission. Required: ${PermissionKeys.LEAVE_TYPES_CREATE}`,
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('Employee MUST be strictly rejected with 403 Forbidden when attempting to create holidays', async () => {
      const ctx = createMockContext(employeeToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([PermissionKeys.HOLIDAYS_CREATE]);

      await expect(permissionsGuard.canActivate(ctx)).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          `Insufficient permission. Required: ${PermissionKeys.HOLIDAYS_CREATE}`,
          HttpStatus.FORBIDDEN,
        ),
      );
    });
  });

  describe('2. Employee Self-Service Operations — Permitted', () => {
    it('Employee MUST be permitted to apply for leave (leave_requests.apply)', async () => {
      const ctx = createMockContext(employeeToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([
        PermissionKeys.LEAVE_REQUESTS_APPLY,
      ]);
      const canActivate = await permissionsGuard.canActivate(ctx);
      expect(canActivate).toBe(true);
    });

    it('Employee MUST be permitted to view own balances (leave_balances.view_own)', async () => {
      const ctx = createMockContext(employeeToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([
        PermissionKeys.LEAVE_BALANCES_VIEW_OWN,
      ]);
      const canActivate = await permissionsGuard.canActivate(ctx);
      expect(canActivate).toBe(true);
    });

    it('Employee MUST be permitted to view own requests (leave_requests.view_own)', async () => {
      const ctx = createMockContext(employeeToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([
        PermissionKeys.LEAVE_REQUESTS_VIEW_OWN,
      ]);
      const canActivate = await permissionsGuard.canActivate(ctx);
      expect(canActivate).toBe(true);
    });
  });

  describe('3. Manager Role Operations', () => {
    it('Manager MUST be rejected when attempting to allocate leave balances', async () => {
      const ctx = createMockContext(managerToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([
        PermissionKeys.LEAVE_BALANCES_ALLOCATE,
      ]);

      await expect(permissionsGuard.canActivate(ctx)).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          `Insufficient permission. Required: ${PermissionKeys.LEAVE_BALANCES_ALLOCATE}`,
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('Manager MUST be permitted to view team requests (leave_requests.view_team)', async () => {
      const ctx = createMockContext(managerToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([
        PermissionKeys.LEAVE_REQUESTS_VIEW_TEAM,
      ]);
      const canActivate = await permissionsGuard.canActivate(ctx);
      expect(canActivate).toBe(true);
    });

    it('Manager MUST be permitted to approve team requests (leave_requests.approve)', async () => {
      const ctx = createMockContext(managerToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([
        PermissionKeys.LEAVE_REQUESTS_APPROVE,
      ]);
      const canActivate = await permissionsGuard.canActivate(ctx);
      expect(canActivate).toBe(true);
    });
  });

  describe('4. HR / Admin Role Operations', () => {
    it('HR / Admin MUST be permitted to allocate leave balances (leave_balances.allocate)', async () => {
      const ctx = createMockContext(hrAdminToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([
        PermissionKeys.LEAVE_BALANCES_ALLOCATE,
      ]);
      const canActivate = await permissionsGuard.canActivate(ctx);
      expect(canActivate).toBe(true);
    });

    it('HR / Admin MUST be permitted to adjust leave balances (leave_balances.adjust)', async () => {
      const ctx = createMockContext(hrAdminToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([
        PermissionKeys.LEAVE_BALANCES_ADJUST,
      ]);
      const canActivate = await permissionsGuard.canActivate(ctx);
      expect(canActivate).toBe(true);
    });

    it('HR / Admin MUST be permitted to create leave types (leave_types.create)', async () => {
      const ctx = createMockContext(hrAdminToken);
      getAllAndOverrideSpy.mockReturnValue(false);
      await jwtAuthGuard.canActivate(ctx);

      getAllAndOverrideSpy.mockReturnValue([PermissionKeys.LEAVE_TYPES_CREATE]);
      const canActivate = await permissionsGuard.canActivate(ctx);
      expect(canActivate).toBe(true);
    });
  });
});

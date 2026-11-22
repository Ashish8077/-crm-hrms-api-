/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-argument */
import {
  ExecutionContext,
  HttpStatus,
  ValidationPipe,
  ValidationError,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { WeeklyOffController } from './weekly-off.controller';
import { WeeklyOffService } from './services/weekly-off.service';
import { WeeklyOffConfigRepository } from './repositories/weekly-off-config.repository';
import { BranchRepository } from '../branches/repositories/branch.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SessionRepository } from '../auth/repositories/session.repository';
import { UserRepository } from '../users/repositories/user.repository';
import { UserStatus } from '../users/constants/user-status.constant';
import { SystemRole } from '../roles/constants/role.constant';
import { ACCESS_TOKEN_COOKIE } from '../auth/constants/auth.constants';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { REQUIRE_PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { mapValidationErrors } from '../../common/validation/validation-error.mapper';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { DayOfWeek } from './constants/weekly-off.constant';
import { CreateWeeklyOffConfigDto } from './dto/create-weekly-off-config.dto';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

describe('WeeklyOff Module Integration Suite', () => {
  let controller: WeeklyOffController;
  let service: WeeklyOffService;
  let validationPipe: ValidationPipe;
  let permissionsGuard: PermissionsGuard;
  let jwtAuthGuard: JwtAuthGuard;
  let reflector: Reflector;

  let weeklyOffRepo: jest.Mocked<WeeklyOffConfigRepository>;
  let branchRepo: jest.Mocked<BranchRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let authorizationService: jest.Mocked<AuthorizationService>;
  let jwtService: jest.Mocked<JwtService>;
  let sessionRepository: jest.Mocked<SessionRepository>;
  let userRepository: jest.Mocked<UserRepository>;

  const adminUserId = new Types.ObjectId();
  const regularUserId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const branch2Id = new Types.ObjectId();

  const mockAdminRequest = {
    user: {
      userId: adminUserId,
      roleIds: [new Types.ObjectId()],
    },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestIntegration/1.0' },
  } as unknown as AuthenticatedRequest;

  const mockRegularRequest = {
    user: {
      userId: regularUserId,
      roleIds: [new Types.ObjectId()],
    },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'JestIntegration/1.0' },
  } as unknown as AuthenticatedRequest;

  const mockSession = {
    withTransaction: jest
      .fn()
      .mockImplementation(async (cb: () => Promise<unknown>) => {
        return cb();
      }),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue(mockSession),
  };

  beforeAll(() => {
    reflector = new Reflector();

    weeklyOffRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findPaginated: jest.fn(),
      findOverlappingConfig: jest.fn(),
      findEffectiveConfig: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<WeeklyOffConfigRepository>;

    branchRepo = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<BranchRepository>;

    auditLogsService = {
      createAuditLog: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<AuditLogsService>;

    authorizationService = {
      hasPermissions: jest.fn(),
    } as unknown as jest.Mocked<AuthorizationService>;

    jwtService = {
      verifyAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    sessionRepository = {
      findActiveSessionByIdAndUserId: jest.fn(),
    } as unknown as jest.Mocked<SessionRepository>;

    userRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    service = new WeeklyOffService(
      weeklyOffRepo,
      branchRepo,
      auditLogsService,
      mockConnection as any,
    );

    controller = new WeeklyOffController(service);

    permissionsGuard = new PermissionsGuard(reflector, authorizationService);
    jwtAuthGuard = new JwtAuthGuard(
      reflector,
      jwtService,
      sessionRepository,
      userRepository,
    );

    validationPipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors: ValidationError[]) => {
        return new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Validation failed',
          HttpStatus.BAD_REQUEST,
          mapValidationErrors(errors),
        );
      },
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('RBAC Guards & Route Permissions', () => {
    it('should require WORK_SCHEDULES_CREATE for POST /work-schedules/weekly-offs', () => {
      const permissions = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        WeeklyOffController.prototype.createConfig,
      );
      expect(permissions).toContain(PermissionKeys.WORK_SCHEDULES_CREATE);
    });

    it('should require WORK_SCHEDULES_VIEW for GET /work-schedules/weekly-offs', () => {
      const permissions = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        WeeklyOffController.prototype.listConfigs,
      );
      expect(permissions).toContain(PermissionKeys.WORK_SCHEDULES_VIEW);
    });

    it('should require WORK_SCHEDULES_VIEW for GET /work-schedules/weekly-offs/effective', () => {
      const permissions = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        WeeklyOffController.prototype.getEffectiveConfig,
      );
      expect(permissions).toContain(PermissionKeys.WORK_SCHEDULES_VIEW);
    });

    it('should require WORK_SCHEDULES_VIEW for GET /work-schedules/weekly-offs/:id', () => {
      const permissions = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        WeeklyOffController.prototype.getConfigById,
      );
      expect(permissions).toContain(PermissionKeys.WORK_SCHEDULES_VIEW);
    });

    it('should require WORK_SCHEDULES_EDIT for PATCH /work-schedules/weekly-offs/:id', () => {
      const permissions = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        WeeklyOffController.prototype.updateConfig,
      );
      expect(permissions).toContain(PermissionKeys.WORK_SCHEDULES_EDIT);
    });

    it('should require WORK_SCHEDULES_EDIT for PATCH /work-schedules/weekly-offs/:id/status', () => {
      const permissions = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        WeeklyOffController.prototype.updateStatus,
      );
      expect(permissions).toContain(PermissionKeys.WORK_SCHEDULES_EDIT);
    });

    it('should require WORK_SCHEDULES_DELETE for DELETE /work-schedules/weekly-offs/:id', () => {
      const permissions = reflector.get<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        WeeklyOffController.prototype.deleteConfig,
      );
      expect(permissions).toContain(PermissionKeys.WORK_SCHEDULES_DELETE);
    });

    it('should allow access through PermissionsGuard when user has required permission', async () => {
      authorizationService.hasPermissions.mockResolvedValue(true);

      const context = {
        getHandler: () => WeeklyOffController.prototype.createConfig,
        getClass: () => WeeklyOffController,
        switchToHttp: () => ({
          getRequest: () => mockAdminRequest,
        }),
      } as unknown as ExecutionContext;

      const canActivate = await permissionsGuard.canActivate(context);
      expect(canActivate).toBe(true);
      expect(authorizationService.hasPermissions).toHaveBeenCalledWith(
        mockAdminRequest.user.roleIds,
        [PermissionKeys.WORK_SCHEDULES_CREATE],
      );
    });

    it('should deny access through PermissionsGuard when user lacks permission', async () => {
      authorizationService.hasPermissions.mockResolvedValue(false);

      const context = {
        getHandler: () => WeeklyOffController.prototype.createConfig,
        getClass: () => WeeklyOffController,
        switchToHttp: () => ({
          getRequest: () => mockRegularRequest,
        }),
      } as unknown as ExecutionContext;

      await expect(permissionsGuard.canActivate(context)).rejects.toThrow(
        AppError,
      );
    });

    describe('Test 10 — Unauthorized update (Security Simulation)', () => {
      const configId = new Types.ObjectId();
      const mockUpdateHandler = WeeklyOffController.prototype.updateConfig;

      const createMockContext = (request: unknown) =>
        ({
          getHandler: () => mockUpdateHandler,
          getClass: () => WeeklyOffController,
          switchToHttp: () => ({
            getRequest: () => request,
          }),
        }) as unknown as ExecutionContext;

      it('Super Admin: Allowed (bypasses permission check and executes update)', async () => {
        const superAdminUserId = new Types.ObjectId();
        const superAdminRoleId = new Types.ObjectId();
        const superAdminSessionId = new Types.ObjectId();

        const superAdminRequest = {
          cookies: { [ACCESS_TOKEN_COOKIE]: 'super.admin.token' },
          ip: '127.0.0.1',
          headers: { 'user-agent': 'JestSecurityTest/1.0' },
        } as unknown as AuthenticatedRequest;

        jwtService.verifyAsync.mockResolvedValue({
          sub: superAdminUserId.toString(),
          sid: superAdminSessionId.toString(),
          type: 'access',
        });
        sessionRepository.findActiveSessionByIdAndUserId.mockResolvedValue({
          _id: superAdminSessionId,
          userId: superAdminUserId,
        } as any);
        userRepository.findById.mockResolvedValue({
          _id: superAdminUserId,
          status: UserStatus.ACTIVE,
          roleIds: [superAdminRoleId],
        } as any);

        const context = createMockContext(superAdminRequest);
        const jwtPassed = await jwtAuthGuard.canActivate(context);
        expect(jwtPassed).toBe(true);
        expect(superAdminRequest.user).toBeDefined();

        authorizationService.hasPermissions.mockResolvedValue(true);
        const permPassed = await permissionsGuard.canActivate(context);
        expect(permPassed).toBe(true);

        weeklyOffRepo.findById.mockResolvedValue({
          _id: configId,
          name: 'Existing Config',
          branchId: null,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          isActive: true,
        } as any);
        weeklyOffRepo.findOverlappingConfig.mockResolvedValue(null);
        weeklyOffRepo.update.mockResolvedValue({
          _id: configId,
          name: 'Super Admin Updated Name',
          branchId: null,
          days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          isActive: true,
        } as any);

        const response = await controller.updateConfig(
          configId,
          { name: 'Super Admin Updated Name' },
          superAdminRequest,
        );
        expect(response.success).toBe(true);
        expect(response.data.name).toBe('Super Admin Updated Name');
      });

      it('Admin with edit permission: Allowed', async () => {
        const adminId = new Types.ObjectId();
        const adminRoleId = new Types.ObjectId();
        const adminSessionId = new Types.ObjectId();

        const adminRequest = {
          cookies: { [ACCESS_TOKEN_COOKIE]: 'admin.edit.token' },
          ip: '127.0.0.1',
          headers: { 'user-agent': 'JestSecurityTest/1.0' },
        } as unknown as AuthenticatedRequest;

        jwtService.verifyAsync.mockResolvedValue({
          sub: adminId.toString(),
          sid: adminSessionId.toString(),
          type: 'access',
        });
        sessionRepository.findActiveSessionByIdAndUserId.mockResolvedValue({
          _id: adminSessionId,
          userId: adminId,
        } as any);
        userRepository.findById.mockResolvedValue({
          _id: adminId,
          status: UserStatus.ACTIVE,
          roleIds: [adminRoleId],
        } as any);

        const context = createMockContext(adminRequest);
        await jwtAuthGuard.canActivate(context);

        authorizationService.hasPermissions.mockResolvedValue(true);
        const permPassed = await permissionsGuard.canActivate(context);
        expect(permPassed).toBe(true);

        weeklyOffRepo.findById.mockResolvedValue({
          _id: configId,
          name: 'Existing Config',
          branchId: null,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          isActive: true,
        } as any);
        weeklyOffRepo.findOverlappingConfig.mockResolvedValue(null);
        weeklyOffRepo.update.mockResolvedValue({
          _id: configId,
          name: 'Admin Edit Updated Name',
          branchId: null,
          days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          isActive: true,
        } as any);

        const response = await controller.updateConfig(
          configId,
          { name: 'Admin Edit Updated Name' },
          adminRequest,
        );
        expect(response.success).toBe(true);
      });

      it('Admin without edit permission: 403 Forbidden', async () => {
        const adminNoEditId = new Types.ObjectId();
        const adminNoEditRoleId = new Types.ObjectId();
        const sessionId = new Types.ObjectId();

        const request = {
          cookies: { [ACCESS_TOKEN_COOKIE]: 'admin.noedit.token' },
          ip: '127.0.0.1',
          headers: { 'user-agent': 'JestSecurityTest/1.0' },
        } as unknown as AuthenticatedRequest;

        jwtService.verifyAsync.mockResolvedValue({
          sub: adminNoEditId.toString(),
          sid: sessionId.toString(),
          type: 'access',
        });
        sessionRepository.findActiveSessionByIdAndUserId.mockResolvedValue({
          _id: sessionId,
          userId: adminNoEditId,
        } as any);
        userRepository.findById.mockResolvedValue({
          _id: adminNoEditId,
          status: UserStatus.ACTIVE,
          roleIds: [adminNoEditRoleId],
        } as any);

        const context = createMockContext(request);
        await jwtAuthGuard.canActivate(context);

        authorizationService.hasPermissions.mockResolvedValue(false);

        await expect(
          permissionsGuard.canActivate(context),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
          statusCode: HttpStatus.FORBIDDEN,
        });
      });

      it('Employee: 403 Forbidden', async () => {
        const empUserId = new Types.ObjectId();
        const empRoleId = new Types.ObjectId();
        const sessionId = new Types.ObjectId();

        const request = {
          cookies: { [ACCESS_TOKEN_COOKIE]: 'employee.token' },
          ip: '127.0.0.1',
          headers: { 'user-agent': 'JestSecurityTest/1.0' },
        } as unknown as AuthenticatedRequest;

        jwtService.verifyAsync.mockResolvedValue({
          sub: empUserId.toString(),
          sid: sessionId.toString(),
          type: 'access',
        });
        sessionRepository.findActiveSessionByIdAndUserId.mockResolvedValue({
          _id: sessionId,
          userId: empUserId,
        } as any);
        userRepository.findById.mockResolvedValue({
          _id: empUserId,
          status: UserStatus.ACTIVE,
          roleIds: [empRoleId],
        } as any);

        const context = createMockContext(request);
        await jwtAuthGuard.canActivate(context);

        authorizationService.hasPermissions.mockResolvedValue(false);

        await expect(
          permissionsGuard.canActivate(context),
        ).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
          statusCode: HttpStatus.FORBIDDEN,
        });
      });

      it('Unauthenticated: 401 Unauthorized', async () => {
        const unauthRequest = {
          cookies: {},
          ip: '127.0.0.1',
          headers: { 'user-agent': 'JestSecurityTest/1.0' },
        } as unknown as AuthenticatedRequest;

        const context = createMockContext(unauthRequest);

        await expect(jwtAuthGuard.canActivate(context)).rejects.toMatchObject({
          code: ErrorCode.UNAUTHORIZED,
          statusCode: HttpStatus.UNAUTHORIZED,
        });
      });

      it('Full RBAC Permission Engine Verification: Super Admin bypass, Admin with edit, Admin without edit, Employee', async () => {
        const superAdminRoleId = new Types.ObjectId();
        const adminWithEditRoleId = new Types.ObjectId();
        const adminNoEditRoleId = new Types.ObjectId();
        const employeeRoleId = new Types.ObjectId();

        const editPermId = new Types.ObjectId();
        const viewPermId = new Types.ObjectId();
        const leavePermId = new Types.ObjectId();

        const mockPermRepo = {
          findActiveByKeys: jest.fn().mockImplementation((keys: string[]) => {
            return Promise.resolve(
              keys.map((key) => {
                if (key === PermissionKeys.WORK_SCHEDULES_EDIT) {
                  return { _id: editPermId, key };
                }
                if (key === PermissionKeys.WORK_SCHEDULES_VIEW) {
                  return { _id: viewPermId, key };
                }
                return { _id: leavePermId, key };
              }),
            );
          }),
        };

        const mockRoleRepo = {
          findActiveByIds: jest
            .fn()
            .mockImplementation((ids: Types.ObjectId[]) => {
              const idStrs = ids.map((id) => id.toString());
              const roles = [];
              if (idStrs.includes(superAdminRoleId.toString())) {
                roles.push({
                  _id: superAdminRoleId,
                  key: SystemRole.SUPER_ADMIN,
                  permissionIds: [],
                });
              }
              if (idStrs.includes(adminWithEditRoleId.toString())) {
                roles.push({
                  _id: adminWithEditRoleId,
                  key: 'admin',
                  permissionIds: [editPermId],
                });
              }
              if (idStrs.includes(adminNoEditRoleId.toString())) {
                roles.push({
                  _id: adminNoEditRoleId,
                  key: 'admin',
                  permissionIds: [viewPermId],
                });
              }
              if (idStrs.includes(employeeRoleId.toString())) {
                roles.push({
                  _id: employeeRoleId,
                  key: 'employee',
                  permissionIds: [leavePermId],
                });
              }
              return Promise.resolve(roles);
            }),
        };

        const authEngine = new AuthorizationService(
          userRepository,
          mockRoleRepo as any,
          mockPermRepo as any,
        );

        // 1. Super Admin bypasses and returns true
        expect(
          await authEngine.hasPermissions(
            [superAdminRoleId],
            [PermissionKeys.WORK_SCHEDULES_EDIT],
          ),
        ).toBe(true);

        // 2. Admin with edit permission returns true
        expect(
          await authEngine.hasPermissions(
            [adminWithEditRoleId],
            [PermissionKeys.WORK_SCHEDULES_EDIT],
          ),
        ).toBe(true);

        // 3. Admin without edit permission returns false
        expect(
          await authEngine.hasPermissions(
            [adminNoEditRoleId],
            [PermissionKeys.WORK_SCHEDULES_EDIT],
          ),
        ).toBe(false);

        // 4. Employee returns false
        expect(
          await authEngine.hasPermissions(
            [employeeRoleId],
            [PermissionKeys.WORK_SCHEDULES_EDIT],
          ),
        ).toBe(false);
      });
    });
  });

  describe('ValidationPipe DTO Enforcement', () => {
    it('should reject payload with missing name', async () => {
      const rawPayload = {
        days: [{ dayOfWeek: 0 }],
        effectiveFrom: '2026-01-01',
      };

      await expect(
        validationPipe.transform(rawPayload, {
          type: 'body',
          metatype: CreateWeeklyOffConfigDto,
        }),
      ).rejects.toThrow(AppError);
    });

    it('should reject invalid calendar date format', async () => {
      const rawPayload = {
        name: 'Invalid Date Config',
        days: [{ dayOfWeek: 0 }],
        effectiveFrom: '2026-02-30', // invalid calendar date!
      };

      await expect(
        validationPipe.transform(rawPayload, {
          type: 'body',
          metatype: CreateWeeklyOffConfigDto,
        }),
      ).rejects.toThrow(AppError);
    });

    it('should reject if dayOfWeek is out of bounds (< 0 or > 6) with detailed field path', async () => {
      const rawPayload = {
        name: 'Invalid Day Of Week',
        days: [{ dayOfWeek: 8 }],
        effectiveFrom: '2026-01-01',
      };

      try {
        await validationPipe.transform(rawPayload, {
          type: 'body',
          metatype: CreateWeeklyOffConfigDto,
        });
        fail('Should have thrown AppError');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
        const details = appErr.details as Array<{
          field: string;
          message: string;
        }>;
        expect(details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'days[0].dayOfWeek',
              message: 'dayOfWeek must be between 0 and 6.',
            }),
          ]),
        );
      }
    });

    it('should reject if occurrences contains values outside 1-5 with exact element field paths', async () => {
      const rawPayload = {
        name: 'Invalid Occurrences',
        days: [{ dayOfWeek: 8, occurrences: [0, 6] }],
        effectiveFrom: '2026-01-01',
      };

      try {
        await validationPipe.transform(rawPayload, {
          type: 'body',
          metatype: CreateWeeklyOffConfigDto,
        });
        fail('Should have thrown AppError');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
        const details = appErr.details as Array<{
          field: string;
          message: string;
        }>;
        expect(details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'days[0].dayOfWeek',
              message: 'dayOfWeek must be between 0 and 6.',
            }),
            expect.objectContaining({
              field: 'days[0].occurrences[0]',
              message: 'Occurrence must be between 1 and 5.',
            }),
            expect.objectContaining({
              field: 'days[0].occurrences[1]',
              message: 'Occurrence must be between 1 and 5.',
            }),
          ]),
        );
      }
    });

    it('should reject duplicate weekday entries via DTO ArrayUnique validation', async () => {
      const rawPayload = {
        name: 'Duplicate Weekdays',
        days: [
          { dayOfWeek: 6, occurrences: [1, 3] },
          { dayOfWeek: 6, occurrences: [2, 4] },
        ],
        effectiveFrom: '2026-01-01',
      };

      try {
        await validationPipe.transform(rawPayload, {
          type: 'body',
          metatype: CreateWeeklyOffConfigDto,
        });
        fail('Should have thrown AppError');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
        const details = appErr.details as Array<{
          field: string;
          message: string;
        }>;
        expect(details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'days',
              message:
                'Duplicate weekday entries are not allowed. Combine occurrences into a single entry.',
            }),
          ]),
        );
      }
    });

    it('should transform and sanitize valid payload', async () => {
      const rawPayload = {
        name: '  Valid Standard Policy  ',
        days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      };

      const transformed = (await validationPipe.transform(rawPayload, {
        type: 'body',
        metatype: CreateWeeklyOffConfigDto,
      })) as CreateWeeklyOffConfigDto;

      expect(transformed.name).toBe('Valid Standard Policy');
      expect(transformed.effectiveFrom).toBe('2026-01-01');
      expect(transformed.effectiveTo).toBe('2026-12-31');
    });
  });

  describe('End-to-End Business Scenarios', () => {
    it('TC-WO-01: Create company-wide standard weekly off (Every Sunday)', async () => {
      const createdId = new Types.ObjectId();
      weeklyOffRepo.findOverlappingConfig.mockResolvedValue(null);
      weeklyOffRepo.create.mockResolvedValue({
        _id: createdId,
        name: 'Standard Company Weekly Off',
        description: 'Every Sunday',
        branchId: null,
        days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const response = await controller.createConfig(
        {
          name: 'Standard Company Weekly Off',
          description: 'Every Sunday',
          days: [{ dayOfWeek: 0 }],
          effectiveFrom: '2026-01-01',
        },
        mockAdminRequest,
      );

      expect(response.success).toBe(true);
      expect(response.data.id).toBe(createdId.toString());
      expect(response.data.branchId).toBeNull();
      expect(response.data.days[0].dayOfWeek).toBe(0);
      expect(response.data.days[0].occurrences).toEqual([1, 2, 3, 4, 5]);
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('TC-WO-02: Create branch-level override (2nd & 4th Saturday + All Sundays)', async () => {
      branchRepo.findById.mockResolvedValue({
        _id: branchId,
        name: 'Bangalore Tech Branch',
        isActive: true,
        deletedAt: null,
      } as any);

      const createdId = new Types.ObjectId();
      weeklyOffRepo.findOverlappingConfig.mockResolvedValue(null);
      weeklyOffRepo.create.mockResolvedValue({
        _id: createdId,
        name: 'Bangalore 2nd/4th Saturday Off',
        branchId,
        days: [
          { dayOfWeek: DayOfWeek.SUNDAY, occurrences: [1, 2, 3, 4, 5] },
          { dayOfWeek: DayOfWeek.SATURDAY, occurrences: [2, 4] },
        ],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const response = await controller.createConfig(
        {
          name: 'Bangalore 2nd/4th Saturday Off',
          branchId: branchId.toString(),
          days: [
            { dayOfWeek: DayOfWeek.SUNDAY, occurrences: [1, 2, 3, 4, 5] },
            { dayOfWeek: DayOfWeek.SATURDAY, occurrences: [2, 4] },
          ],
          effectiveFrom: '2026-01-01',
        },
        mockAdminRequest,
      );

      expect(response.success).toBe(true);
      expect(response.data.branchId).toBe(branchId.toString());
      expect(response.data.days).toHaveLength(2);
    });

    it('TC-WO-03: Prevent conflicting active configurations for same branch scope (409 Conflict)', async () => {
      weeklyOffRepo.findOverlappingConfig.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Active Ongoing Company Off',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      } as any);

      await expect(
        controller.createConfig(
          {
            name: 'Conflicting Company Off',
            days: [{ dayOfWeek: 0 }],
            effectiveFrom: '2026-06-01',
          },
          mockAdminRequest,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          "An active weekly off configuration 'Active Ongoing Company Off' already overlaps with effective dates [2026-01-01 to ongoing] for this scope.",
          HttpStatus.CONFLICT,
        ),
      );
    });

    it('TC-WO-04: Allow active configurations across different branch scopes simultaneously', async () => {
      // Branch 1 has active config
      // Now creating for Branch 2 should not conflict even on identical dates
      branchRepo.findById.mockResolvedValue({
        _id: branch2Id,
        name: 'Mumbai Branch',
        isActive: true,
        deletedAt: null,
      } as any);

      weeklyOffRepo.findOverlappingConfig.mockResolvedValue(null);
      weeklyOffRepo.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Mumbai Custom Off',
        branchId: branch2Id,
        days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
      } as any);

      const response = await controller.createConfig(
        {
          name: 'Mumbai Custom Off',
          branchId: branch2Id.toString(),
          days: [{ dayOfWeek: 0 }],
          effectiveFrom: '2026-01-01',
        },
        mockAdminRequest,
      );

      expect(response.success).toBe(true);
      expect(response.data.branchId).toBe(branch2Id.toString());
    });

    it('TC-WO-05: Effective config resolution prioritizing branch override over company default', async () => {
      const branchConfig = {
        _id: new Types.ObjectId(),
        name: 'Branch Special Off',
        branchId,
        days: [
          { dayOfWeek: DayOfWeek.SATURDAY, occurrences: [2, 4] },
          { dayOfWeek: DayOfWeek.SUNDAY, occurrences: [1, 2, 3, 4, 5] },
        ],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
      };

      weeklyOffRepo.findEffectiveConfig.mockImplementation((_date, bId) =>
        Promise.resolve(
          bId && bId.toString() === branchId.toString()
            ? (branchConfig as any)
            : null,
        ),
      );

      // October 10, 2026 is 2nd Saturday
      const res2ndSat = await controller.getEffectiveConfig({
        date: '2026-10-10',
        branchId: branchId.toString(),
      });
      expect(res2ndSat.data.source).toBe('BRANCH_OVERRIDE');
      expect(res2ndSat.data.isWeeklyOff).toBe(true);

      // October 17, 2026 is 3rd Saturday (not weekly off for this branch)
      const res3rdSat = await controller.getEffectiveConfig({
        date: '2026-10-17',
        branchId: branchId.toString(),
      });
      expect(res3rdSat.data.source).toBe('BRANCH_OVERRIDE');
      expect(res3rdSat.data.isWeeklyOff).toBe(false);
    });

    it('TC-WO-06: Effective config resolution falling back to company default', async () => {
      const companyConfig = {
        _id: new Types.ObjectId(),
        name: 'Company Default Policy',
        branchId: null,
        days: [{ dayOfWeek: DayOfWeek.SUNDAY, occurrences: [1, 2, 3, 4, 5] }],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
      };

      weeklyOffRepo.findEffectiveConfig.mockImplementation((_date, bId) =>
        Promise.resolve(bId === null ? (companyConfig as any) : null),
      );

      // Query with a branch that has no branch-specific override
      const resSunday = await controller.getEffectiveConfig({
        date: '2026-10-11', // Sunday
        branchId: branch2Id.toString(),
      });
      expect(resSunday.data.source).toBe('COMPANY_DEFAULT');
      expect(resSunday.data.isWeeklyOff).toBe(true);

      const resSaturday = await controller.getEffectiveConfig({
        date: '2026-10-10', // Saturday
        branchId: branch2Id.toString(),
      });
      expect(resSaturday.data.source).toBe('COMPANY_DEFAULT');
      expect(resSaturday.data.isWeeklyOff).toBe(false);
    });

    it('TC-WO-07: Effective config resolution falling back to system default (Every Sunday)', async () => {
      weeklyOffRepo.findEffectiveConfig.mockResolvedValue(null);

      const resSunday = await controller.getEffectiveConfig({
        date: '2026-10-11', // Sunday
      });
      expect(resSunday.data.source).toBe('SYSTEM_DEFAULT');
      expect(resSunday.data.isWeeklyOff).toBe(true);

      const resMonday = await controller.getEffectiveConfig({
        date: '2026-10-12', // Monday
      });
      expect(resMonday.data.source).toBe('SYSTEM_DEFAULT');
      expect(resMonday.data.isWeeklyOff).toBe(false);
    });

    it('TC-WO-08: Update configuration details and date intervals', async () => {
      const configId = new Types.ObjectId();
      const existingDoc = {
        _id: configId,
        name: 'Old Policy Name',
        branchId: null,
        days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
      };

      weeklyOffRepo.findById.mockResolvedValue(existingDoc as any);
      weeklyOffRepo.findOverlappingConfig.mockResolvedValue(null);
      weeklyOffRepo.update.mockResolvedValue({
        ...existingDoc,
        name: 'New Policy Name',
        effectiveTo: '2026-12-31',
      } as any);

      const response = await controller.updateConfig(
        configId,
        {
          name: 'New Policy Name',
          effectiveTo: '2026-12-31',
        },
        mockAdminRequest,
      );

      expect(response.success).toBe(true);
      expect(response.data.name).toBe('New Policy Name');
      expect(response.data.effectiveTo).toBe('2026-12-31');
    });

    it('TC-WO-09: Activate and deactivate status with overlap guard', async () => {
      const configId = new Types.ObjectId();
      const existingDoc = {
        _id: configId,
        name: 'Test Policy',
        branchId: null,
        isActive: true,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      };

      // 1. Deactivate
      weeklyOffRepo.findById.mockResolvedValue(existingDoc as any);
      weeklyOffRepo.update.mockResolvedValue({
        ...existingDoc,
        isActive: false,
      } as any);

      const deactRes = await controller.updateStatus(
        configId,
        { isActive: false },
        mockAdminRequest,
      );
      expect(deactRes.data.isActive).toBe(false);

      // 2. Reactivate with conflicting config
      weeklyOffRepo.findById.mockResolvedValue({
        ...existingDoc,
        isActive: false,
      } as any);
      weeklyOffRepo.findOverlappingConfig.mockResolvedValue({
        _id: new Types.ObjectId(),
        name: 'Other Policy',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      } as any);

      await expect(
        controller.updateStatus(configId, { isActive: true }, mockAdminRequest),
      ).rejects.toThrow(AppError);
    });

    describe('Test 9 — Duplicate or overlapping active configuration on update', () => {
      it('should reject update with 409 Conflict if new dates overlap another active config for the SAME branch scope', async () => {
        const configAId = new Types.ObjectId();
        const configBId = new Types.ObjectId();

        const configB = {
          _id: configBId,
          name: 'Bangalore Policy H2',
          branchId,
          days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-12-31',
          isActive: true,
        };

        const conflictingConfigA = {
          _id: configAId,
          name: 'Bangalore Policy H1',
          branchId,
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-06-30',
          isActive: true,
        };

        weeklyOffRepo.findById.mockResolvedValue(configB as any);
        weeklyOffRepo.findOverlappingConfig.mockResolvedValue(
          conflictingConfigA as any,
        );

        await expect(
          controller.updateConfig(
            configBId,
            { effectiveFrom: '2026-06-15' },
            mockAdminRequest,
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.RESOURCE_ALREADY_EXISTS,
          statusCode: HttpStatus.CONFLICT,
        });

        expect(weeklyOffRepo.findOverlappingConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            branchId,
            effectiveFrom: '2026-06-15',
            effectiveTo: '2026-12-31',
            excludeId: configBId,
          }),
        );
      });

      it('should reject update with 409 Conflict if new dates overlap another active config for the company-wide scope', async () => {
        const companyConfig1Id = new Types.ObjectId();
        const companyConfig2Id = new Types.ObjectId();

        const companyConfig2 = {
          _id: companyConfig2Id,
          name: 'Company Policy 2026 Q3-Q4',
          branchId: null,
          days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-12-31',
          isActive: true,
        };

        const conflictingCompanyConfig1 = {
          _id: companyConfig1Id,
          name: 'Company Policy 2026 Q1-Q2',
          branchId: null,
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-06-30',
          isActive: true,
        };

        weeklyOffRepo.findById.mockResolvedValue(companyConfig2 as any);
        weeklyOffRepo.findOverlappingConfig.mockResolvedValue(
          conflictingCompanyConfig1 as any,
        );

        await expect(
          controller.updateConfig(
            companyConfig2Id,
            { effectiveFrom: '2026-05-01' },
            mockAdminRequest,
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.RESOURCE_ALREADY_EXISTS,
          statusCode: HttpStatus.CONFLICT,
        });

        expect(weeklyOffRepo.findOverlappingConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            branchId: null,
            effectiveFrom: '2026-05-01',
            excludeId: companyConfig2Id,
          }),
        );
      });

      it('should NOT reject branch-override and company-default combinations merely because their dates overlap', async () => {
        const branchConfigId = new Types.ObjectId();
        const branchConfig = {
          _id: branchConfigId,
          name: 'Bangalore Branch Override',
          branchId,
          days: [
            { dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] },
            { dayOfWeek: 6, occurrences: [2, 4] },
          ],
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          isActive: true,
        };

        weeklyOffRepo.findById.mockResolvedValue(branchConfig as any);
        // Scoped to branchId only — does not match or conflict with branchId: null
        weeklyOffRepo.findOverlappingConfig.mockResolvedValue(null);
        weeklyOffRepo.update.mockResolvedValue({
          ...branchConfig,
          name: 'Updated Bangalore Override',
        } as any);

        const response = await controller.updateConfig(
          branchConfigId,
          { name: 'Updated Bangalore Override' },
          mockAdminRequest,
        );

        expect(response.success).toBe(true);
        expect(response.data.name).toBe('Updated Bangalore Override');
        expect(weeklyOffRepo.findOverlappingConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            branchId,
            excludeId: branchConfigId,
          }),
        );
      });

      it('should allow updating active config when no other config overlaps (self-exclusion via excludeId)', async () => {
        const singleConfigId = new Types.ObjectId();
        const existing = {
          _id: singleConfigId,
          name: 'Single Branch Policy',
          branchId,
          days: [{ dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] }],
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-12-31',
          isActive: true,
        };

        weeklyOffRepo.findById.mockResolvedValue(existing as any);
        weeklyOffRepo.findOverlappingConfig.mockResolvedValue(null);
        weeklyOffRepo.update.mockResolvedValue({
          ...existing,
          days: [
            { dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] },
            { dayOfWeek: 6, occurrences: [2, 4] },
          ],
        } as any);

        const response = await controller.updateConfig(
          singleConfigId,
          {
            days: [
              { dayOfWeek: 0, occurrences: [1, 2, 3, 4, 5] },
              { dayOfWeek: 6, occurrences: [2, 4] },
            ],
          },
          mockAdminRequest,
        );

        expect(response.success).toBe(true);
        expect(weeklyOffRepo.findOverlappingConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            branchId,
            excludeId: singleConfigId,
          }),
        );
      });
    });

    it('TC-WO-10: Soft delete configuration', async () => {
      const configId = new Types.ObjectId();
      weeklyOffRepo.findById.mockResolvedValue({
        _id: configId,
        name: 'Policy to Delete',
        branchId: null,
      } as any);
      weeklyOffRepo.softDelete.mockResolvedValue({} as any);

      const deleteRes = await controller.deleteConfig(
        configId,
        mockAdminRequest,
      );
      expect(deleteRes.success).toBe(true);
      expect(deleteRes.message).toBe(
        'Weekly off configuration successfully deleted',
      );
      expect(weeklyOffRepo.softDelete).toHaveBeenCalledWith(
        configId,
        adminUserId,
        mockSession,
      );
    });
  });
});

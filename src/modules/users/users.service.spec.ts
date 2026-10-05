/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { UsersService } from './users.service';
import { UserRepository } from './repositories/user.repository';
import { RoleRepository } from '../roles/repositories/role.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { getConnectionToken } from '@nestjs/mongoose';
import { ErrorCode } from '../../common/errors/error-codes';
import { AppError } from '../../common/errors/app-error';
import { HttpStatus } from '@nestjs/common';
import { AuthorizationService } from '../authorization/authorization.service';
import { SessionRepository } from '../auth/repositories/session.repository';

describe('UsersService - assignRoles', () => {
  let service: UsersService;
  let userRepository: jest.Mocked<UserRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let authService: Record<string, jest.Mock>;
  let connection: any;
  let mockSession: any;

  beforeEach(async () => {
    userRepository = {
      findById: jest.fn(),
      updateRoles: jest.fn(),
      updateById: jest.fn(),
      findByEmail: jest.fn(),
      findList: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
    } as any;

    roleRepository = {
      findActiveByIds: jest.fn(),
      findByKey: jest.fn(),
    } as any;

    auditLogsService = {
      createAuditLog: jest.fn(),
    } as any;

    authService = {
      assertIsActiveSuperAdmin: jest.fn().mockResolvedValue(true),
    };

    mockSession = {
      withTransaction: jest.fn().mockImplementation(async (cb) => {
        return await cb();
      }),
      endSession: jest.fn(),
    };
    connection = {
      startSession: jest.fn().mockResolvedValue(mockSession),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UserRepository, useValue: userRepository },
        { provide: RoleRepository, useValue: roleRepository },
        { provide: AuditLogsService, useValue: auditLogsService },
        {
          provide: SessionRepository,
          useValue: { revokeAllSessionsForUser: jest.fn() },
        },
        { provide: AuthorizationService, useValue: authService },
        { provide: getConnectionToken(), useValue: connection },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  const setupUsers = (
    targetRoleIds: Types.ObjectId[],
    actorRoleIds: Types.ObjectId[],
  ) => {
    const mockUser = {
      _id: new Types.ObjectId(),
      roleIds: [...targetRoleIds],
    };
    const mockActor = {
      _id: new Types.ObjectId(),
      roleIds: [...actorRoleIds],
    };

    userRepository.findById.mockImplementation((id: unknown) => {
      const idStr = String(id);
      if (idStr === mockUser._id.toString())
        return Promise.resolve(mockUser as any);
      if (idStr === mockActor._id.toString())
        return Promise.resolve(mockActor as any);
      return Promise.resolve(null);
    });

    userRepository.updateRoles.mockResolvedValue(mockUser as any);
    return { mockUser, mockActor };
  };

  const superAdminId = new Types.ObjectId();
  const normalRoleId1 = new Types.ObjectId();
  const normalRoleId2 = new Types.ObjectId();

  beforeEach(() => {
    roleRepository.findByKey.mockResolvedValue({ _id: superAdminId } as any);
  });

  describe('Authorization: Actor Authority', () => {
    it('SUPER_ADMIN actor can assign normal roles', async () => {
      const { mockUser, mockActor } = setupUsers([], [superAdminId]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: normalRoleId1 } as any,
      ]);

      await service.assignRoles(
        mockUser._id,
        { roleIds: [normalRoleId1] },
        mockActor._id,
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      );
      expect(userRepository.updateRoles).toHaveBeenCalledWith(
        mockUser._id,
        [normalRoleId1],
        mockSession,
      );
    });

    it('SUPER_ADMIN actor attempting to assign SUPER_ADMIN to normal user -> 403', async () => {
      const { mockUser, mockActor } = setupUsers([], [superAdminId]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: superAdminId, key: 'super-admin' } as any,
      ]);

      await expect(
        service.assignRoles(
          mockUser._id,
          { roleIds: [superAdminId] },
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('Non-Super-Admin -> assign role: 403', async () => {
      const { mockUser, mockActor } = setupUsers([], [normalRoleId2]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: normalRoleId1 } as any,
      ]);
      authService.assertIsActiveSuperAdmin.mockRejectedValue(
        new AppError(ErrorCode.FORBIDDEN, 'Forbidden', HttpStatus.FORBIDDEN),
      );

      await expect(
        service.assignRoles(
          mockUser._id,
          { roleIds: [normalRoleId1] },
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('User with no role -> assign role: 403', async () => {
      const { mockUser, mockActor } = setupUsers([], []);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: normalRoleId1 } as any,
      ]);
      authService.assertIsActiveSuperAdmin.mockRejectedValue(
        new AppError(ErrorCode.FORBIDDEN, 'Forbidden', HttpStatus.FORBIDDEN),
      );

      await expect(
        service.assignRoles(
          mockUser._id,
          { roleIds: [normalRoleId1] },
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('User -> assign role to self: 403', async () => {
      const { mockUser } = setupUsers([], [superAdminId]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: normalRoleId1 } as any,
      ]);

      await expect(
        service.assignRoles(
          mockUser._id,
          { roleIds: [normalRoleId1] },
          mockUser._id, // Actor is the same as Target
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });
  });

  describe('Target Invariants: SUPER_ADMIN exclusivity', () => {
    it('Normal user -> [SUPER_ADMIN, ADMIN] -> rejected', async () => {
      const { mockUser, mockActor } = setupUsers([], [superAdminId]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: superAdminId, key: 'super-admin' } as any,
        { _id: normalRoleId1 } as any,
      ]);

      await expect(
        service.assignRoles(
          mockUser._id,
          { roleIds: [superAdminId, normalRoleId1] },
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('Existing SUPER_ADMIN -> [SUPER_ADMIN] -> rejected', async () => {
      const { mockUser, mockActor } = setupUsers(
        [superAdminId],
        [superAdminId],
      );
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: superAdminId, key: 'super-admin' } as any,
      ]);

      await expect(
        service.assignRoles(
          mockUser._id,
          { roleIds: [superAdminId] },
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('Existing SUPER_ADMIN -> [ADMIN] -> rejected', async () => {
      const { mockUser, mockActor } = setupUsers(
        [superAdminId],
        [superAdminId],
      );
      roleRepository.findActiveByIds
        .mockResolvedValueOnce([
          { _id: superAdminId, key: 'super-admin' } as any,
        ])
        .mockResolvedValueOnce([{ _id: normalRoleId1 } as any]);

      await expect(
        service.assignRoles(
          mockUser._id,
          { roleIds: [normalRoleId1] },
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('Existing SUPER_ADMIN -> [SUPER_ADMIN, ADMIN] -> rejected', async () => {
      const { mockUser, mockActor } = setupUsers(
        [superAdminId],
        [superAdminId],
      );
      roleRepository.findActiveByIds
        .mockResolvedValueOnce([
          { _id: superAdminId, key: 'super-admin' } as any,
        ])
        .mockResolvedValueOnce([
          { _id: superAdminId, key: 'super-admin' } as any,
          { _id: normalRoleId1 } as any,
        ]);

      await expect(
        service.assignRoles(
          mockUser._id,
          { roleIds: [superAdminId, normalRoleId1] },
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('Existing SUPER_ADMIN -> [] -> rejected', async () => {
      const { mockUser, mockActor } = setupUsers(
        [superAdminId],
        [superAdminId],
      );
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: superAdminId, key: 'super-admin' } as any,
      ]);

      await expect(
        service.assignRoles(mockUser._id, { roleIds: [] }, mockActor._id, {
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });
  });

  describe('Normal Role Assignment & Edge Cases', () => {
    it('Normal user -> [HR, FINANCE] -> allowed', async () => {
      const { mockUser, mockActor } = setupUsers([], [normalRoleId2]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: normalRoleId1 } as any,
        { _id: normalRoleId2 } as any,
      ]);

      await service.assignRoles(
        mockUser._id,
        { roleIds: [normalRoleId1, normalRoleId2] },
        mockActor._id,
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      );
      expect(userRepository.updateRoles).toHaveBeenCalledWith(
        mockUser._id,
        [normalRoleId1, normalRoleId2],
        mockSession,
      );
    });

    it('Normal user -> [FINANCE, HR] when current is [HR, FINANCE] -> no-op', async () => {
      const { mockUser, mockActor } = setupUsers(
        [normalRoleId1, normalRoleId2],
        [superAdminId],
      );
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: normalRoleId1 } as any,
        { _id: normalRoleId2 } as any,
      ]);

      // Reversed order
      await service.assignRoles(
        mockUser._id,
        { roleIds: [normalRoleId2, normalRoleId1] },
        mockActor._id,
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      );
      expect(userRepository.updateRoles).not.toHaveBeenCalled();
    });

    it('Duplicate role IDs are deduplicated', async () => {
      const { mockUser, mockActor } = setupUsers([], [superAdminId]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: normalRoleId1 } as any,
      ]);

      await service.assignRoles(
        mockUser._id,
        { roleIds: [normalRoleId1, normalRoleId1] },
        mockActor._id,
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      );
      expect(userRepository.updateRoles).toHaveBeenCalledWith(
        mockUser._id,
        [normalRoleId1],
        mockSession,
      );
    });

    it('Invalid/non-existent role -> 400', async () => {
      const { mockUser, mockActor } = setupUsers([], [superAdminId]);
      roleRepository.findActiveByIds.mockResolvedValue([]); // Database returns empty

      await expect(
        service.assignRoles(
          mockUser._id,
          { roleIds: [normalRoleId1] },
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it('Audit failure rolls back transaction', async () => {
      const { mockUser, mockActor } = setupUsers([], [superAdminId]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: normalRoleId1 } as any,
      ]);

      const error = new Error('Audit failed');
      auditLogsService.createAuditLog.mockRejectedValue(error);

      await expect(
        service.assignRoles(
          mockUser._id,
          { roleIds: [normalRoleId1] },
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toThrow('Audit failed');
    });

    it('User not found -> 404', async () => {
      const { mockActor } = setupUsers([], [superAdminId]); // Not creating target user mock matching the generated id
      const missingUserId = new Types.ObjectId();

      await expect(
        service.assignRoles(missingUserId, { roleIds: [] }, mockActor._id, {
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_FOUND });
    });
  });

  describe('UsersService - create', () => {
    it('should create a user successfully', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      const createdUser = {
        _id: new Types.ObjectId(),
        email: 'new@example.com',
      };
      userRepository.create.mockResolvedValue(createdUser as any);

      const result = await service.create(
        { email: 'new@example.com', password: 'Password123!' },
        new Types.ObjectId(),
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      );

      expect(result.email).toBe('new@example.com');
      expect(auditLogsService.createAuditLog).toHaveBeenCalled();
    });

    it('should throw RESOURCE_ALREADY_EXISTS if email is taken', async () => {
      userRepository.findByEmail.mockResolvedValue({
        _id: new Types.ObjectId(),
        email: 'taken@example.com',
      } as any);

      await expect(
        service.create(
          { email: 'taken@example.com', password: 'Password123!' },
          new Types.ObjectId(),
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_ALREADY_EXISTS });
    });
  });

  describe('UsersService - list', () => {
    it('Normal users appear and Super Admin is excluded via repository call', async () => {
      const mockQuery: any = { page: 1, limit: 10 };
      const normalUser = {
        _id: new Types.ObjectId(),
        email: 'normal@test.com',
      };
      userRepository.findList.mockResolvedValue({
        data: [normalUser] as any,
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const result = await service.list(mockQuery);

      expect(roleRepository.findByKey).toHaveBeenCalledWith('super-admin');
      expect(userRepository.findList).toHaveBeenCalledWith(mockQuery, [
        superAdminId,
      ]);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].email).toBe('normal@test.com');
      expect(result.meta.total).toBe(1);
    });

    it('If Super Admin role is missing, calls findList with empty exclusion array', async () => {
      const mockQuery: any = { page: 1, limit: 10 };
      roleRepository.findByKey.mockResolvedValueOnce(null);
      userRepository.findList.mockResolvedValue({
        data: [],
        meta: {
          total: 0,
          page: 1,
          limit: 10,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      await service.list(mockQuery);

      expect(userRepository.findList).toHaveBeenCalledWith(mockQuery, []);
    });
  });

  describe('UsersService - update', () => {
    it('Update normal user -> allowed when authorized', async () => {
      const { mockUser, mockActor } = setupUsers([], []);
      userRepository.findById.mockResolvedValue(mockUser as any);
      userRepository.updateById.mockResolvedValue({
        ...mockUser,
        email: 'new@example.com',
      } as any);

      const result = await service.update(
        mockUser._id,
        { email: 'new@example.com' },
        mockActor._id,
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      );

      expect(result.email).toBe('new@example.com');
      expect(userRepository.updateById).toHaveBeenCalledWith(
        mockUser._id,
        { email: 'new@example.com', updatedBy: mockActor._id },
        mockSession,
      );
    });

    it('Update Super Admin email -> 403', async () => {
      const { mockUser, mockActor } = setupUsers([superAdminId], []);
      userRepository.findById.mockResolvedValue(mockUser as any);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: superAdminId, key: 'super-admin' } as any,
      ]);

      await expect(
        service.update(
          mockUser._id,
          { email: 'hacked@example.com' },
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('Update Super Admin password/roles/unknown fields through User API -> 403', async () => {
      const { mockUser, mockActor } = setupUsers([superAdminId], []);
      userRepository.findById.mockResolvedValue(mockUser as any);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: superAdminId, key: 'super-admin' } as any,
      ]);

      await expect(
        service.update(
          mockUser._id,
          { password: 'newpassword', roleIds: ['some-role'] } as any,
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('Attempt unknown/sensitive fields -> rejected by mass-assignment (normal user)', async () => {
      const { mockUser, mockActor } = setupUsers([], []);
      userRepository.findById.mockResolvedValue(mockUser as any);
      userRepository.updateById.mockResolvedValue(mockUser as any);

      await service.update(
        mockUser._id,
        {
          email: 'ok@example.com',
          passwordHash: 'hacked',
          roleIds: ['hacked-role'],
        } as any,
        mockActor._id,
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      );

      // Verify that updateData only contains email and updatedBy
      expect(userRepository.updateById).toHaveBeenCalledWith(
        mockUser._id,
        { email: 'ok@example.com', updatedBy: mockActor._id },
        mockSession,
      );
    });
    it('should throw RESOURCE_ALREADY_EXISTS if updating to an existing email', async () => {
      const { mockUser, mockActor } = setupUsers([], []);
      const existingUser = {
        _id: new Types.ObjectId(),
        email: 'taken@example.com',
      };

      userRepository.findByEmail.mockResolvedValue(existingUser as any);

      await expect(
        service.update(
          mockUser._id,
          { email: 'taken@example.com' },
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_ALREADY_EXISTS });
    });
  });

  describe('UsersService - updateStatus', () => {
    it('Update Super Admin status -> 403', async () => {
      const { mockUser, mockActor } = setupUsers([superAdminId], []);
      userRepository.findById.mockResolvedValue(mockUser as any);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: superAdminId, key: 'super-admin' } as any,
      ]);

      await expect(
        service.updateStatus(
          mockUser._id,
          { status: 'inactive' as any },
          mockActor._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('Normal user status update -> allowed', async () => {
      const { mockUser, mockActor } = setupUsers([], []);
      userRepository.findById.mockResolvedValue(mockUser as any);
      userRepository.updateStatus.mockResolvedValue({
        ...mockUser,
        status: 'inactive',
      } as any);

      const result = await service.updateStatus(
        mockUser._id,
        { status: 'inactive' as any },
        mockActor._id,
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      );

      expect(result.status).toBe('inactive');
      expect(userRepository.updateStatus).toHaveBeenCalledWith(
        mockUser._id,
        'inactive',
        mockSession,
      );
    });

    it('Self status update -> 403', async () => {
      const { mockUser } = setupUsers([], []);

      await expect(
        service.updateStatus(
          mockUser._id,
          { status: 'inactive' as any },
          mockUser._id,
          { ipAddress: '127.0.0.1', userAgent: 'test' },
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });
  });
});

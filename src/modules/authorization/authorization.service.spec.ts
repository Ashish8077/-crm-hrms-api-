/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AuthorizationService } from './authorization.service';
import { UserRepository } from '../users/repositories/user.repository';
import { RoleRepository } from '../roles/repositories/role.repository';
import { PermissionRepository } from '../permissions/repositories/permission.repository';
import { SystemRole } from '../roles/constants/role.constant';

describe('AuthorizationService', () => {
  let service: AuthorizationService;
  let userRepository: jest.Mocked<UserRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let permissionRepository: jest.Mocked<PermissionRepository>;

  beforeEach(async () => {
    userRepository = {
      findById: jest.fn(),
    } as any;

    roleRepository = {
      findActiveByIds: jest.fn(),
    } as any;

    permissionRepository = {
      findActiveByKey: jest.fn(),
      findActiveByKeys: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        { provide: UserRepository, useValue: userRepository },
        { provide: RoleRepository, useValue: roleRepository },
        { provide: PermissionRepository, useValue: permissionRepository },
      ],
    }).compile();

    service = module.get<AuthorizationService>(AuthorizationService);
  });

  describe('hasPermissions', () => {
    it('should allow if requiredPermissionKeys is empty or undefined without querying DB', async () => {
      const roleId = new Types.ObjectId();
      expect(await service.hasPermissions([roleId], [])).toBe(true);
      expect(await service.hasPermissions([roleId], undefined as any)).toBe(
        true,
      );

      expect(permissionRepository.findActiveByKeys).not.toHaveBeenCalled();
      expect(roleRepository.findActiveByIds).not.toHaveBeenCalled();
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('should deny if roleIds is empty or undefined without querying DB', async () => {
      expect(await service.hasPermissions([], ['roles.view'])).toBe(false);
      expect(
        await service.hasPermissions(undefined as any, ['roles.view']),
      ).toBe(false);

      expect(permissionRepository.findActiveByKeys).not.toHaveBeenCalled();
      expect(roleRepository.findActiveByIds).not.toHaveBeenCalled();
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('should deduplicate requiredPermissionKeys before querying DB', async () => {
      const roleId = new Types.ObjectId();
      const permId = new Types.ObjectId();

      permissionRepository.findActiveByKeys.mockResolvedValue([
        { _id: permId, key: 'roles.view' } as any,
      ]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: roleId, permissionIds: [permId] } as any,
      ]);

      const result = await service.hasPermissions(
        [roleId],
        ['roles.view', 'roles.view', 'roles.view'],
      );

      expect(result).toBe(true);
      expect(permissionRepository.findActiveByKeys).toHaveBeenCalledTimes(1);
      expect(permissionRepository.findActiveByKeys).toHaveBeenCalledWith([
        'roles.view',
      ]);
      expect(roleRepository.findActiveByIds).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate roleIds before querying DB', async () => {
      const roleId = new Types.ObjectId();
      const permId = new Types.ObjectId();

      permissionRepository.findActiveByKeys.mockResolvedValue([
        { _id: permId, key: 'roles.view' } as any,
      ]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: roleId, permissionIds: [permId] } as any,
      ]);

      const result = await service.hasPermissions(
        [roleId, roleId],
        ['roles.view'],
      );

      expect(result).toBe(true);
      expect(roleRepository.findActiveByIds).toHaveBeenCalledTimes(1);
      expect(roleRepository.findActiveByIds).toHaveBeenCalledWith([roleId]);
    });

    it('should allow a single required permission when active role grants it', async () => {
      const roleId = new Types.ObjectId();
      const permId = new Types.ObjectId();

      permissionRepository.findActiveByKeys.mockResolvedValue([
        { _id: permId, key: 'roles.view' } as any,
      ]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: roleId, permissionIds: [permId] } as any,
      ]);

      const result = await service.hasPermissions([roleId], ['roles.view']);

      expect(result).toBe(true);
      expect(userRepository.findById).not.toHaveBeenCalled();
      expect(permissionRepository.findActiveByKeys).toHaveBeenCalledTimes(1);
      expect(roleRepository.findActiveByIds).toHaveBeenCalledTimes(1);
    });

    it('should allow multiple required permissions in 1 batch when all are granted', async () => {
      const roleId = new Types.ObjectId();
      const perm1Id = new Types.ObjectId();
      const perm2Id = new Types.ObjectId();

      permissionRepository.findActiveByKeys.mockResolvedValue([
        { _id: perm1Id, key: 'roles.view' } as any,
        { _id: perm2Id, key: 'roles.edit' } as any,
      ]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: roleId, permissionIds: [perm1Id, perm2Id] } as any,
      ]);

      const result = await service.hasPermissions(
        [roleId],
        ['roles.view', 'roles.edit'],
      );

      expect(result).toBe(true);
      expect(permissionRepository.findActiveByKeys).toHaveBeenCalledTimes(1);
      expect(permissionRepository.findActiveByKeys).toHaveBeenCalledWith([
        'roles.view',
        'roles.edit',
      ]);
      expect(roleRepository.findActiveByIds).toHaveBeenCalledTimes(1);
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('should deny if one of the multiple permissions is missing from user roles', async () => {
      const roleId = new Types.ObjectId();
      const perm1Id = new Types.ObjectId();
      const perm2Id = new Types.ObjectId();

      permissionRepository.findActiveByKeys.mockResolvedValue([
        { _id: perm1Id, key: 'roles.view' } as any,
        { _id: perm2Id, key: 'roles.edit' } as any,
      ]);
      // Role only grants perm1Id, missing perm2Id
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: roleId, permissionIds: [perm1Id] } as any,
      ]);

      const result = await service.hasPermissions(
        [roleId],
        ['roles.view', 'roles.edit'],
      );

      expect(result).toBe(false);
    });

    it('should deny if any required permission is inactive or missing from DB', async () => {
      const roleId = new Types.ObjectId();
      const perm1Id = new Types.ObjectId();

      // Only 1 of 2 required permissions is returned active
      permissionRepository.findActiveByKeys.mockResolvedValue([
        { _id: perm1Id, key: 'roles.view' } as any,
      ]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: roleId, permissionIds: [perm1Id] } as any,
      ]);

      const result = await service.hasPermissions(
        [roleId],
        ['roles.view', 'inactive.permission'],
      );

      expect(result).toBe(false);
    });

    it('should deny if user roles are inactive or not found', async () => {
      const permId = new Types.ObjectId();

      permissionRepository.findActiveByKeys.mockResolvedValue([
        { _id: permId, key: 'roles.view' } as any,
      ]);
      roleRepository.findActiveByIds.mockResolvedValue([]);

      const result = await service.hasPermissions(
        [new Types.ObjectId()],
        ['roles.view'],
      );

      expect(result).toBe(false);
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('should bypass and allow all permissions if any role is SUPER_ADMIN', async () => {
      const perm1Id = new Types.ObjectId();
      const perm2Id = new Types.ObjectId();

      permissionRepository.findActiveByKeys.mockResolvedValue([
        { _id: perm1Id, key: 'roles.view' } as any,
        { _id: perm2Id, key: 'roles.delete' } as any,
      ]);

      roleRepository.findActiveByIds.mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          key: SystemRole.SUPER_ADMIN,
          permissionIds: [], // Empty permission IDs bypassed
        } as any,
      ]);

      const result = await service.hasPermissions(
        [new Types.ObjectId()],
        ['roles.view', 'roles.delete'],
      );

      expect(result).toBe(true);
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('should resolve effective permissions across multiple roles', async () => {
      const role1Id = new Types.ObjectId();
      const role2Id = new Types.ObjectId();
      const perm1Id = new Types.ObjectId();
      const perm2Id = new Types.ObjectId();

      permissionRepository.findActiveByKeys.mockResolvedValue([
        { _id: perm1Id, key: 'roles.view' } as any,
        { _id: perm2Id, key: 'roles.edit' } as any,
      ]);

      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: role1Id, permissionIds: [perm1Id] } as any, // Grants roles.view
        { _id: role2Id, permissionIds: [perm2Id] } as any, // Grants roles.edit
      ]);

      const result = await service.hasPermissions(
        [role1Id, role2Id],
        ['roles.view', 'roles.edit'],
      );

      expect(result).toBe(true);
    });

    it('should rethrow errors from permissionRepository', async () => {
      const error = new Error('Permission query failed');
      permissionRepository.findActiveByKeys.mockRejectedValue(error);
      roleRepository.findActiveByIds.mockResolvedValue([]);

      await expect(
        service.hasPermissions([new Types.ObjectId()], ['roles.view']),
      ).rejects.toThrow('Permission query failed');
    });

    it('should rethrow errors from roleRepository', async () => {
      permissionRepository.findActiveByKeys.mockResolvedValue([
        { _id: new Types.ObjectId(), key: 'roles.view' } as any,
      ]);
      const error = new Error('Role query failed');
      roleRepository.findActiveByIds.mockRejectedValue(error);

      await expect(
        service.hasPermissions([new Types.ObjectId()], ['roles.view']),
      ).rejects.toThrow('Role query failed');
    });
  });

  describe('hasPermission (delegation)', () => {
    it('should delegate to hasPermissions with a single key array', async () => {
      const roleId = new Types.ObjectId();
      const permId = new Types.ObjectId();

      permissionRepository.findActiveByKeys.mockResolvedValue([
        { _id: permId, key: 'roles.view' } as any,
      ]);
      roleRepository.findActiveByIds.mockResolvedValue([
        { _id: roleId, permissionIds: [permId] } as any,
      ]);

      const result = await service.hasPermission([roleId], 'roles.view');

      expect(result).toBe(true);
      expect(permissionRepository.findActiveByKeys).toHaveBeenCalledWith([
        'roles.view',
      ]);
    });
  });
});

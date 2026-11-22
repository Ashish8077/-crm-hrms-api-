/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/unbound-method */
import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types, Connection, ClientSession } from 'mongoose';

import { RolesService } from './roles.service';
import { RoleRepository } from './repositories/role.repository';
import { PermissionRepository } from '../permissions/repositories/permission.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/constants/audit-log.constant';
import { SystemRole } from './constants/role.constant';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateRoleStatusDto } from './dto/update-role-status.dto';

describe('RolesService — Role Management & Superadmin Protection', () => {
  let service: RolesService;
  let roleRepository: jest.Mocked<RoleRepository>;
  let permissionRepository: jest.Mocked<PermissionRepository>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let connection: jest.Mocked<Connection>;
  let mockUsersCollection: { findOne: jest.Mock };
  let mockSession: ClientSession;

  const actorId = new Types.ObjectId();
  const superAdminRoleId = new Types.ObjectId();
  const customRoleId = new Types.ObjectId();
  const perm1Id = new Types.ObjectId();
  const perm2Id = new Types.ObjectId();

  const clientMetadata = {
    ipAddress: '127.0.0.1',
    userAgent: 'JestTestAgent',
  };

  beforeEach(async () => {
    mockSession = {} as ClientSession;
    mockUsersCollection = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    roleRepository = {
      createCustomRole: jest.fn(),
      findById: jest.fn(),
      findByKey: jest.fn(),
      updateCustomRole: jest.fn(),
      updateStatus: jest.fn(),
      findAll: jest.fn(),
      findPaginated: jest.fn(),
      findActiveByIds: jest.fn(),
      deleteById: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<RoleRepository>;

    permissionRepository = {
      findActiveByIds: jest.fn(),
      findActiveByKeys: jest.fn(),
    } as unknown as jest.Mocked<PermissionRepository>;

    auditLogsService = {
      createAuditLog: jest.fn().mockResolvedValue({} as any),
    } as unknown as jest.Mocked<AuditLogsService>;

    connection = {
      transaction: jest
        .fn()
        .mockImplementation(
          async (cb: (session: ClientSession) => Promise<any>) =>
            cb(mockSession),
        ),
      collection: jest.fn().mockReturnValue(mockUsersCollection),
    } as unknown as jest.Mocked<Connection>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: RoleRepository, useValue: roleRepository },
        { provide: PermissionRepository, useValue: permissionRepository },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: getConnectionToken(), useValue: connection },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Custom Role Creation & Permission Assignment', () => {
    it('Superadmin can create a custom role (e.g. Employee) with explicit permissions and isSystem=false', async () => {
      const createDto: CreateRoleDto = {
        name: 'Employee',
        key: 'employee',
        description: 'Standard employee self-service role',
        permissionIds: [perm1Id],
      };

      roleRepository.findByKey.mockResolvedValue(null);
      permissionRepository.findActiveByIds.mockResolvedValue([
        { _id: perm1Id, key: 'leave_requests.apply', isActive: true } as any,
      ]);

      const createdDoc = {
        _id: customRoleId,
        name: createDto.name,
        key: createDto.key,
        description: createDto.description,
        permissionIds: [perm1Id],
        isSystemRole: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      roleRepository.createCustomRole.mockResolvedValue(createdDoc as any);

      const result = await service.create(createDto, actorId, clientMetadata);

      expect(roleRepository.findByKey).toHaveBeenCalledWith('employee');
      expect(permissionRepository.findActiveByIds).toHaveBeenCalledWith([
        perm1Id,
      ]);
      expect(roleRepository.createCustomRole).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'employee',
          name: 'Employee',
          isSystemRole: false,
          permissionIds: [perm1Id],
        }),
        mockSession,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId,
          action: AuditAction.ROLE_CREATED,
          targetId: customRoleId,
        }),
        mockSession,
      );

      expect(result.key).toBe('employee');
      expect(result.isSystemRole).toBe(false);
      expect(result.permissionIds).toEqual([perm1Id.toString()]);
    });

    it('Superadmin can create Admin/HR custom roles without automatic grants based on role name', async () => {
      const createDto: CreateRoleDto = {
        name: 'Admin',
        key: 'admin',
        description: 'Custom administrative role',
        permissionIds: [perm1Id, perm2Id],
      };

      roleRepository.findByKey.mockResolvedValue(null);
      permissionRepository.findActiveByIds.mockResolvedValue([
        { _id: perm1Id, key: 'leave_balances.allocate', isActive: true } as any,
        { _id: perm2Id, key: 'leave_balances.adjust', isActive: true } as any,
      ]);

      const createdDoc = {
        _id: customRoleId,
        name: createDto.name,
        key: createDto.key,
        description: createDto.description,
        permissionIds: [perm1Id, perm2Id],
        isSystemRole: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      roleRepository.createCustomRole.mockResolvedValue(createdDoc as any);

      const result = await service.create(createDto, actorId, clientMetadata);

      // Verify that no extra permissions were silently added merely because name is 'Admin'
      expect(result.permissionIds).toHaveLength(2);
      expect(result.permissionIds).toEqual([
        perm1Id.toString(),
        perm2Id.toString(),
      ]);
      expect(result.isSystemRole).toBe(false);
    });

    it('prohibits creating a role with reserved key "super-admin"', async () => {
      const createDto: CreateRoleDto = {
        name: 'Another Super Admin',
        key: 'super-admin',
        permissionIds: [perm1Id],
      };

      await expect(
        service.create(createDto, actorId, clientMetadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          `Cannot create a role with reserved key '${SystemRole.SUPER_ADMIN}'`,
          HttpStatus.FORBIDDEN,
        ),
      );

      expect(roleRepository.createCustomRole).not.toHaveBeenCalled();
    });

    it('rejects creation if role key already exists (409 Conflict)', async () => {
      const createDto: CreateRoleDto = {
        name: 'Custom HR',
        key: 'custom-hr',
        permissionIds: [perm1Id],
      };

      roleRepository.findByKey.mockResolvedValue({
        _id: new Types.ObjectId(),
        key: 'custom-hr',
      } as any);

      await expect(
        service.create(createDto, actorId, clientMetadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          "Role with key 'custom-hr' already exists",
          HttpStatus.CONFLICT,
        ),
      );
    });

    it('rejects creation if assigned permission does not exist or is inactive', async () => {
      const createDto: CreateRoleDto = {
        name: 'Finance',
        key: 'finance',
        permissionIds: [perm1Id, perm2Id],
      };

      roleRepository.findByKey.mockResolvedValue(null);
      // Return only 1 active permission instead of 2
      permissionRepository.findActiveByIds.mockResolvedValue([
        { _id: perm1Id, key: 'perm1', isActive: true } as any,
      ]);

      await expect(
        service.create(createDto, actorId, clientMetadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'One or more assigned permissions are invalid, inactive, or do not exist',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });
  });

  describe('2. Superadmin Role Protection from Modification', () => {
    it('MUST throw 403 Forbidden when attempting to update Superadmin role details', async () => {
      const updateDto: UpdateRoleDto = {
        name: 'Renamed Super Admin',
      };

      roleRepository.findById.mockResolvedValue({
        _id: superAdminRoleId,
        key: SystemRole.SUPER_ADMIN,
        name: 'Super Admin',
        isSystemRole: true,
      } as any);

      await expect(
        service.update(superAdminRoleId, updateDto, actorId, clientMetadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Superadmin role cannot be modified',
          HttpStatus.FORBIDDEN,
        ),
      );

      expect(roleRepository.updateCustomRole).not.toHaveBeenCalled();
    });

    it('MUST throw 403 Forbidden when attempting to update any role with isSystemRole=true', async () => {
      const updateDto: UpdateRoleDto = {
        description: 'Changed description',
      };

      roleRepository.findById.mockResolvedValue({
        _id: superAdminRoleId,
        key: 'system-special-role',
        name: 'Special System Role',
        isSystemRole: true,
      } as any);

      await expect(
        service.update(superAdminRoleId, updateDto, actorId, clientMetadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Superadmin role cannot be modified',
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('allows updating custom roles (name, description, permissions)', async () => {
      const updateDto: UpdateRoleDto = {
        name: 'Senior Employee',
        permissionIds: [perm2Id],
      };

      const existingDoc = {
        _id: customRoleId,
        key: 'employee',
        name: 'Employee',
        isSystemRole: false,
        permissionIds: [perm1Id],
        isActive: true,
      };

      roleRepository.findById.mockResolvedValue(existingDoc as any);
      permissionRepository.findActiveByIds.mockResolvedValue([
        { _id: perm2Id, key: 'leave_requests.apply', isActive: true } as any,
      ]);

      const updatedDoc = {
        ...existingDoc,
        name: 'Senior Employee',
        permissionIds: [perm2Id],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      roleRepository.updateCustomRole.mockResolvedValue(updatedDoc as any);

      const result = await service.update(
        customRoleId,
        updateDto,
        actorId,
        clientMetadata,
      );

      expect(roleRepository.updateCustomRole).toHaveBeenCalled();
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ROLE_UPDATED,
          targetId: customRoleId,
        }),
        mockSession,
      );
      expect(result.name).toBe('Senior Employee');
      expect(result.permissionIds).toEqual([perm2Id.toString()]);
    });
  });

  describe('3. Superadmin Role Protection from Deactivation', () => {
    it('MUST throw 403 Forbidden when attempting to deactivate Superadmin role', async () => {
      const statusDto: UpdateRoleStatusDto = {
        isActive: false,
      };

      roleRepository.findById.mockResolvedValue({
        _id: superAdminRoleId,
        key: SystemRole.SUPER_ADMIN,
        isSystemRole: true,
        isActive: true,
      } as any);

      await expect(
        service.updateStatus(
          superAdminRoleId,
          statusDto,
          actorId,
          clientMetadata,
        ),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Superadmin role cannot be deactivated or have its status changed',
          HttpStatus.FORBIDDEN,
        ),
      );

      expect(roleRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('allows changing status of custom roles', async () => {
      const statusDto: UpdateRoleStatusDto = {
        isActive: false,
      };

      const customRole = {
        _id: customRoleId,
        key: 'custom-role',
        isSystemRole: false,
        isActive: true,
        permissionIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      roleRepository.findById.mockResolvedValue(customRole as any);
      roleRepository.updateStatus.mockResolvedValue({
        ...customRole,
        isActive: false,
      } as any);

      const result = await service.updateStatus(
        customRoleId,
        statusDto,
        actorId,
        clientMetadata,
      );

      expect(roleRepository.updateStatus).toHaveBeenCalledWith(
        customRoleId,
        false,
        mockSession,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ROLE_STATUS_CHANGED,
        }),
        mockSession,
      );
      expect(result.isActive).toBe(false);
    });
  });

  describe('4. Superadmin Role Protection from Deletion & Safe Deletion of Custom Roles', () => {
    it('MUST throw 403 Forbidden when attempting to delete Superadmin role', async () => {
      roleRepository.findById.mockResolvedValue({
        _id: superAdminRoleId,
        key: SystemRole.SUPER_ADMIN,
        name: 'Super Admin',
        isSystemRole: true,
      } as any);

      await expect(
        service.delete(superAdminRoleId, actorId, clientMetadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.FORBIDDEN,
          'Superadmin role cannot be deleted',
          HttpStatus.FORBIDDEN,
        ),
      );

      expect(roleRepository.deleteById).not.toHaveBeenCalled();
    });

    it('MUST reject deletion with 409 Conflict if custom role is currently assigned to users', async () => {
      roleRepository.findById.mockResolvedValue({
        _id: customRoleId,
        key: 'assigned-role',
        name: 'Assigned Role',
        isSystemRole: false,
      } as any);

      // User exists with this role
      mockUsersCollection.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        email: 'employee@company.com',
      });

      await expect(
        service.delete(customRoleId, actorId, clientMetadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Cannot delete role because it is currently assigned to one or more users',
          HttpStatus.CONFLICT,
        ),
      );

      expect(roleRepository.deleteById).not.toHaveBeenCalled();
    });

    it('successfully deletes an unassigned custom role and writes audit log', async () => {
      roleRepository.findById.mockResolvedValue({
        _id: customRoleId,
        key: 'unused-role',
        name: 'Unused Custom Role',
        isSystemRole: false,
      } as any);

      mockUsersCollection.findOne.mockResolvedValue(null);

      await service.delete(customRoleId, actorId, clientMetadata);

      expect(roleRepository.deleteById).toHaveBeenCalledWith(
        customRoleId,
        mockSession,
      );
      expect(auditLogsService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ROLE_DELETED,
          targetId: customRoleId,
          details: {
            key: 'unused-role',
            name: 'Unused Custom Role',
          },
        }),
        mockSession,
      );
    });

    it('throws 404 Not Found if role does not exist', async () => {
      roleRepository.findById.mockResolvedValue(null);

      await expect(
        service.delete(new Types.ObjectId(), actorId, clientMetadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Role not found',
          HttpStatus.NOT_FOUND,
        ),
      );
    });
  });
});

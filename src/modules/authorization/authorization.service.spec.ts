/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AuthorizationService } from './authorization.service';
import { UserRepository } from '../users/repositories/user.repository';
import { RoleRepository } from '../roles/repositories/role.repository';
import { PermissionRepository } from '../permissions/repositories/permission.repository';
import { UserStatus } from '../users/constants/user-status.constant';

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

  it('should deny if user is not found', async () => {
    userRepository.findById.mockResolvedValue(null);
    const result = await service.hasPermission(
      new Types.ObjectId(),
      'roles.view',
    );
    expect(result).toBe(false);
  });

  it('should deny if user is inactive', async () => {
    userRepository.findById.mockResolvedValue({
      status: UserStatus.INACTIVE,
    } as any);
    const result = await service.hasPermission(
      new Types.ObjectId(),
      'roles.view',
    );
    expect(result).toBe(false);
  });

  it('should deny if role is inactive or not found', async () => {
    userRepository.findById.mockResolvedValue({
      status: UserStatus.ACTIVE,
      roleIds: [new Types.ObjectId()],
    } as any);
    permissionRepository.findActiveByKey.mockResolvedValue({
      _id: new Types.ObjectId(),
    } as any);

    // Active roles array is empty
    roleRepository.findActiveByIds.mockResolvedValue([]);

    const result = await service.hasPermission(
      new Types.ObjectId(),
      'roles.view',
    );
    expect(result).toBe(false);
  });

  it('should deny if permission is inactive or not found', async () => {
    userRepository.findById.mockResolvedValue({
      status: UserStatus.ACTIVE,
      roleIds: [new Types.ObjectId()],
    } as any);
    permissionRepository.findActiveByKey.mockResolvedValue(null);

    const result = await service.hasPermission(
      new Types.ObjectId(),
      'invalid.permission',
    );
    expect(result).toBe(false);
  });

  it('should allow if active user + active role + active permission matches', async () => {
    const roleId = new Types.ObjectId();
    const permId = new Types.ObjectId();

    userRepository.findById.mockResolvedValue({
      status: UserStatus.ACTIVE,
      roleIds: [roleId],
    } as any);

    permissionRepository.findActiveByKey.mockResolvedValue({
      _id: permId,
    } as any);

    roleRepository.findActiveByIds.mockResolvedValue([
      { _id: roleId, permissionIds: [permId] } as any,
    ]);

    const result = await service.hasPermission(
      new Types.ObjectId(),
      'roles.view',
    );
    expect(result).toBe(true);
  });

  it('should resolve effective permissions correctly with multiple roles', async () => {
    const role1Id = new Types.ObjectId();
    const role2Id = new Types.ObjectId();
    const permId = new Types.ObjectId();

    userRepository.findById.mockResolvedValue({
      status: UserStatus.ACTIVE,
      roleIds: [role1Id, role2Id],
    } as any);

    permissionRepository.findActiveByKey.mockResolvedValue({
      _id: permId,
    } as any);

    roleRepository.findActiveByIds.mockResolvedValue([
      { _id: role1Id, permissionIds: [new Types.ObjectId()] } as any, // Missing the required permission
      { _id: role2Id, permissionIds: [permId] } as any, // Has the required permission
    ]);

    const result = await service.hasPermission(
      new Types.ObjectId(),
      'roles.view',
    );
    expect(result).toBe(true); // Should return true because at least one role grants it
  });

  it('should rethrow internal errors', async () => {
    const error = new Error('Database connection failed');
    userRepository.findById.mockRejectedValue(error);

    await expect(
      service.hasPermission(new Types.ObjectId(), 'roles.view'),
    ).rejects.toThrow('Database connection failed');
  });
});

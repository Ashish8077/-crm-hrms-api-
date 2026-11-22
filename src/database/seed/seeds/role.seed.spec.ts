/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-member-access */
import { Types, Model } from 'mongoose';
import { RoleSeed } from './role.seed';
import { Role } from '../../../modules/roles/schemas/role.schema';
import { Permission } from '../../../modules/permissions/schemas/permission.schema';
import { SystemRole } from '../../../modules/roles/constants/role.constant';

describe('RoleSeed — Single System Role Architecture', () => {
  let roleSeed: RoleSeed;
  let mockRoleModel: jest.Mocked<Model<Role>>;
  let mockPermissionModel: jest.Mocked<Model<Permission>>;

  const perm1Id = new Types.ObjectId();
  const perm2Id = new Types.ObjectId();

  beforeEach(() => {
    mockPermissionModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { _id: perm1Id, key: 'users.view', isActive: true },
            { _id: perm2Id, key: 'roles.create', isActive: true },
          ]),
        }),
      }),
    } as any;

    mockRoleModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
      bulkWrite: jest.fn().mockResolvedValue({} as any),
    } as any;

    roleSeed = new RoleSeed(mockRoleModel, mockPermissionModel);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('MUST seed only Superadmin as a system role with all permissions', async () => {
    await roleSeed.run();

    // Verify permissions were fetched
    expect(mockPermissionModel.find).toHaveBeenCalledWith({ isActive: true });

    // Verify bulkWrite was called with exactly 1 system role (Superadmin)
    expect(mockRoleModel.bulkWrite).toHaveBeenCalledTimes(1);
    const bulkOps = mockRoleModel.bulkWrite.mock.calls[0][0] as any[];
    expect(bulkOps).toHaveLength(1);

    const superAdminOp = bulkOps[0].updateOne;
    expect(superAdminOp.filter).toEqual({ key: SystemRole.SUPER_ADMIN });
    expect(superAdminOp.update.$set).toEqual(
      expect.objectContaining({
        name: 'Super Admin',
        isSystemRole: true,
        permissionIds: [perm1Id, perm2Id],
      }),
    );
  });

  it('throws an error if no active permissions exist to seed Superadmin', async () => {
    mockPermissionModel.find.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
    } as any);

    await expect(roleSeed.run()).rejects.toThrow(
      'Cannot seed roles: no active permissions found in the database.',
    );

    expect(mockRoleModel.bulkWrite).not.toHaveBeenCalled();
  });
});

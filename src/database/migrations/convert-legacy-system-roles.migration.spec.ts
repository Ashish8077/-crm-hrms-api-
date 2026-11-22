/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { Model } from 'mongoose';
import { ConvertLegacySystemRolesMigration } from './convert-legacy-system-roles.migration';
import { Role } from '../../modules/roles/schemas/role.schema';
import { SystemRole } from '../../modules/roles/constants/role.constant';

describe('ConvertLegacySystemRolesMigration', () => {
  let migration: ConvertLegacySystemRolesMigration;
  let mockRoleModel: jest.Mocked<Model<Role>>;

  beforeEach(() => {
    mockRoleModel = {
      updateMany: jest.fn().mockResolvedValue({
        modifiedCount: 4,
        matchedCount: 4,
        acknowledged: true,
      } as any),
    } as any;

    migration = new ConvertLegacySystemRolesMigration(mockRoleModel);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('converts legacy system roles to custom roles while excluding Superadmin', async () => {
    const result = await migration.run();

    expect(mockRoleModel.updateMany).toHaveBeenCalledTimes(1);
    expect(mockRoleModel.updateMany).toHaveBeenCalledWith(
      {
        key: { $ne: SystemRole.SUPER_ADMIN },
        isSystemRole: true,
      },
      {
        $set: { isSystemRole: false },
      },
    );
    expect(result).toEqual({ modifiedCount: 4 });
  });

  it('completes gracefully when no legacy roles need conversion', async () => {
    (mockRoleModel.updateMany as jest.Mock).mockResolvedValueOnce({
      modifiedCount: 0,
      matchedCount: 0,
      acknowledged: true,
    });

    const result = await migration.run();

    expect(result).toEqual({ modifiedCount: 0 });
  });
});

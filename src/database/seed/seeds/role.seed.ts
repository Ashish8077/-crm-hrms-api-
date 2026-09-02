import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { Role } from '../../../modules/roles/schemas/role.schema';
import { Permission } from '../../../modules/permissions/schemas/permission.schema';
import { SystemRole } from '../../../modules/roles/constants/role.constant';

export class RoleSeed {
  private readonly logger = new Logger(RoleSeed.name);

  constructor(
    private readonly roleModel: Model<Role>,
    private readonly permissionModel: Model<Permission>,
  ) {}

  async run(): Promise<void> {
    this.logger.log('Seeding roles...');

    // Resolve permissions for Super Admin
    const permissions = await this.permissionModel
      .find({}, { _id: 1 })
      .lean()
      .exec();
    const permissionIds = permissions.map(({ _id }) => _id);

    if (permissionIds.length === 0) {
      throw new Error('Cannot seed Super Admin role: no permissions found.');
    }

    const superAdminRole: Partial<Role> = {
      name: 'Super Admin',
      key: SystemRole.SUPER_ADMIN,
      description: 'System administrator with full access',
      permissionIds,
      isSystemRole: true,
      isActive: true,
    };

    await this.roleModel.findOneAndUpdate(
      { key: SystemRole.SUPER_ADMIN },
      { $set: superAdminRole },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    this.logger.log('Roles seeded successfully.');
  }
}

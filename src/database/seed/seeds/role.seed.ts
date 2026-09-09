import { Logger } from '@nestjs/common';
import { Model, Types, AnyBulkWriteOperation } from 'mongoose';
import { Role } from '../../../modules/roles/schemas/role.schema';
import { Permission } from '../../../modules/permissions/schemas/permission.schema';
import { SystemRole } from '../../../modules/roles/constants/role.constant';

interface SystemRoleDefinition {
  key: SystemRole;
  name: string;
  description: string;
  permissionKeys: string[] | 'ALL';
}

const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    key: SystemRole.SUPER_ADMIN,
    name: 'Super Admin',
    description: 'System administrator with full access',
    permissionKeys: 'ALL',
  },
  {
    key: SystemRole.ADMIN,
    name: 'Admin',
    description: 'Administrative access to core system operations',
    permissionKeys: [],
  },
  {
    key: SystemRole.HR_MANAGER,
    name: 'HR Manager',
    description: 'Human resources management and approval access',
    permissionKeys: [],
  },
  {
    key: SystemRole.HR,
    name: 'HR',
    description: 'Human resources operational access',
    permissionKeys: [],
  },
  {
    key: SystemRole.FINANCE,
    name: 'Finance',
    description: 'Finance and payroll-related access',
    permissionKeys: [],
  },
  {
    key: SystemRole.SALES_MANAGER,
    name: 'Sales Manager',
    description: 'Sales management and assignment access',
    permissionKeys: [],
  },
  {
    key: SystemRole.SALES_EXECUTIVE,
    name: 'Sales Executive',
    description: 'Sales execution access',
    permissionKeys: [],
  },
  {
    key: SystemRole.EMPLOYEE,
    name: 'Employee',
    description: 'Employee self-service access',
    permissionKeys: [],
  },
];

export class RoleSeed {
  private readonly logger = new Logger(RoleSeed.name);

  constructor(
    private readonly roleModel: Model<Role>,
    private readonly permissionModel: Model<Permission>,
  ) {}

  async run(): Promise<void> {
    this.logger.log('Seeding roles...');

    // 1. Fetch all active permissions
    const activePermissions = await this.permissionModel
      .find({ isActive: true })
      .lean()
      .exec();

    const permissionMap = new Map<string, Types.ObjectId>();
    for (const p of activePermissions) {
      // Typescript knows _id exists on documents but lean() drops full hydration types sometimes
      permissionMap.set(p.key, p._id);
    }

    if (activePermissions.length === 0) {
      throw new Error(
        'Cannot seed roles: no active permissions found in the database.',
      );
    }

    // 2. Prevent overriding custom roles
    const systemRoleKeys = SYSTEM_ROLES.map((r) => r.key);
    const conflictingRoles = await this.roleModel
      .find({
        key: { $in: systemRoleKeys },
        isSystemRole: false,
      })
      .lean()
      .exec();

    if (conflictingRoles.length > 0) {
      const conflictKeys = conflictingRoles.map((r) => r.key).join(', ');
      throw new Error(
        `Role seed conflict: Roles with keys [${conflictKeys}] already exist as custom roles (isSystemRole: false). ` +
          `The seed cannot safely override them.`,
      );
    }

    // 3. Prepare bulk operations
    const bulkOps: AnyBulkWriteOperation<Role>[] = [];

    for (const roleDef of SYSTEM_ROLES) {
      let resolvedPermissionIds: Types.ObjectId[] = [];

      if (roleDef.permissionKeys === 'ALL') {
        resolvedPermissionIds = Array.from(permissionMap.values());
      } else {
        for (const key of roleDef.permissionKeys) {
          const id = permissionMap.get(key);
          if (!id) {
            throw new Error(
              `Role seed failed: Permission key '${key}' required by role '${roleDef.key}' is missing or inactive.`,
            );
          }
          resolvedPermissionIds.push(id);
        }
      }

      bulkOps.push({
        updateOne: {
          filter: { key: roleDef.key },
          update: {
            $set: {
              name: roleDef.name,
              description: roleDef.description,
              isSystemRole: true,
              permissionIds: resolvedPermissionIds,
            },
            $setOnInsert: {
              isActive: true,
            },
          },
          upsert: true,
        },
      });
    }

    // 4. Execute
    if (bulkOps.length > 0) {
      await this.roleModel.bulkWrite(bulkOps);
    }

    this.logger.log(
      `Roles seeded successfully. System roles processed: ${SYSTEM_ROLES.length}`,
    );
  }
}

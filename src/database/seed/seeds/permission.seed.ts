import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { Permission } from '../../../modules/permissions/schemas/permission.schema';
import { PermissionAction } from '../../../modules/permissions/constants/permission.constant';

export class PermissionSeed {
  private readonly logger = new Logger(PermissionSeed.name);

  constructor(private readonly permissionModel: Model<Permission>) {}

  async run(): Promise<void> {
    this.logger.log('Seeding permissions...');

    const permissions: Partial<Permission>[] = [
      // Users
      ...this.generatePermissions('users', [
        PermissionAction.CREATE,
        PermissionAction.VIEW,
        PermissionAction.EDIT,
        PermissionAction.DELETE,
      ]),
      // Roles
      ...this.generatePermissions('roles', [
        PermissionAction.CREATE,
        PermissionAction.VIEW,
        PermissionAction.EDIT,
        PermissionAction.DELETE,
      ]),
      // Permissions
      {
        module: 'permissions',
        action: PermissionAction.VIEW,
        key: 'permissions.view',
        isActive: true,
      },
      // Add other finalized modules here as needed based on swagger tags:
      // employees, attendance, leave, performance, expenses, payroll, recruitment, assets, helpdesk, training, leads, deals, organization
      ...this.generatePermissions('employees', [
        PermissionAction.VIEW,
        PermissionAction.CREATE,
        PermissionAction.EDIT,
        PermissionAction.DELETE,
        PermissionAction.EXPORT,
      ]),
      ...this.generatePermissions('attendance', [
        PermissionAction.VIEW,
        PermissionAction.CREATE,
        PermissionAction.EDIT,
        PermissionAction.APPROVE,
        PermissionAction.EXPORT,
      ]),
      ...this.generatePermissions('leave', [
        PermissionAction.VIEW,
        PermissionAction.CREATE,
        PermissionAction.EDIT,
        PermissionAction.APPROVE,
      ]),
      ...this.generatePermissions('expenses', [
        PermissionAction.VIEW,
        PermissionAction.CREATE,
        PermissionAction.EDIT,
        PermissionAction.APPROVE,
      ]),
      ...this.generatePermissions('payroll', [
        PermissionAction.VIEW,
        PermissionAction.CREATE,
        PermissionAction.EDIT,
        PermissionAction.APPROVE,
        PermissionAction.EXPORT,
      ]),
      ...this.generatePermissions('recruitment', [
        PermissionAction.VIEW,
        PermissionAction.CREATE,
        PermissionAction.EDIT,
        PermissionAction.DELETE,
        PermissionAction.APPROVE,
        PermissionAction.EXPORT,
        PermissionAction.ASSIGN,
      ]),
      ...this.generatePermissions('leads', [
        PermissionAction.VIEW,
        PermissionAction.CREATE,
        PermissionAction.EDIT,
        PermissionAction.DELETE,
        PermissionAction.EXPORT,
        PermissionAction.ASSIGN,
      ]),
      ...this.generatePermissions('deals', [
        PermissionAction.VIEW,
        PermissionAction.CREATE,
        PermissionAction.EDIT,
        PermissionAction.DELETE,
        PermissionAction.EXPORT,
        PermissionAction.ASSIGN,
      ]),
    ];

    for (const p of permissions) {
      await this.permissionModel.updateOne(
        { key: p.key },
        { $setOnInsert: p },
        { upsert: true },
      );
    }

    this.logger.log('Permissions seeded successfully.');
  }

  private generatePermissions(
    module: string,
    actions: PermissionAction[],
  ): Partial<Permission>[] {
    return actions.map((action) => ({
      module,
      action,
      key: `${module}.${action}`,
      isActive: true,
    }));
  }
}

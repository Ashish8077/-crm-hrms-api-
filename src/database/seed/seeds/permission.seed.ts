import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { Permission } from '../../../modules/permissions/schemas/permission.schema';
import {
  PermissionAction,
  PermissionModule,
} from '../../../modules/permissions/constants/permission.constant';

const { VIEW, CREATE, EDIT, DELETE, EXPORT, APPROVE, ASSIGN } =
  PermissionAction;
const M = PermissionModule;

/**
 * Full module/action-based permission catalog based on the requirement
 * document's modules and supported actions.
 *
 * Each module only gets the actions that are semantically meaningful for it.
 */
const PERMISSION_CATALOG: Record<PermissionModule, PermissionAction[]> = {
  // ── Core ──────────────────────────────────────────────────────────
  [M.USERS]: [VIEW, CREATE, EDIT, DELETE, EXPORT, ASSIGN],
  [M.ROLES]: [VIEW, CREATE, EDIT, DELETE],
  [M.PERMISSIONS]: [VIEW],

  // ── Organization ─────────────────────────────────────────────────
  [M.DEPARTMENTS]: [VIEW, CREATE, EDIT, DELETE],
  [M.TEAMS]: [VIEW, CREATE, EDIT, DELETE],
  [M.DESIGNATIONS]: [VIEW, CREATE, EDIT, DELETE],
  [M.BRANCHES]: [VIEW, CREATE, EDIT, DELETE],

  // ── CRM ──────────────────────────────────────────────────────────
  [M.LEADS]: [VIEW, CREATE, EDIT, DELETE, EXPORT, ASSIGN],
  [M.CONTACTS]: [VIEW, CREATE, EDIT, DELETE, EXPORT],
  [M.COMPANIES]: [VIEW, CREATE, EDIT, DELETE, EXPORT],
  [M.DEALS]: [VIEW, CREATE, EDIT, DELETE, EXPORT, APPROVE, ASSIGN],
  [M.TASKS]: [VIEW, CREATE, EDIT, DELETE, ASSIGN],
  [M.ACTIVITIES]: [VIEW, CREATE, EDIT, DELETE],
  [M.PRODUCTS]: [VIEW, CREATE, EDIT, DELETE, EXPORT],
  [M.QUOTATIONS]: [VIEW, CREATE, EDIT, DELETE, EXPORT, APPROVE],

  // ── HR ───────────────────────────────────────────────────────────
  [M.EMPLOYEES]: [VIEW, CREATE, EDIT, DELETE, EXPORT, ASSIGN],
  [M.ATTENDANCE]: [VIEW, CREATE, EDIT, APPROVE, EXPORT],
  [M.LEAVES]: [VIEW, CREATE, EDIT, DELETE, APPROVE, EXPORT],
  [M.PERFORMANCE]: [VIEW, CREATE, EDIT, APPROVE, EXPORT],
  [M.EXPENSES]: [VIEW, CREATE, EDIT, DELETE, APPROVE, EXPORT],
  [M.TRAVEL]: [VIEW, CREATE, EDIT, DELETE, APPROVE, EXPORT],

  // ── Payroll / Tax ────────────────────────────────────────────────
  [M.SALARY]: [VIEW, CREATE, EDIT, EXPORT],
  [M.PAYROLL]: [VIEW, CREATE, EDIT, APPROVE, EXPORT],
  [M.PAYSLIPS]: [VIEW, CREATE, EXPORT],
  [M.TAX]: [VIEW, CREATE, EDIT, APPROVE, EXPORT],

  // ── Recruitment / HR Operations ──────────────────────────────────
  [M.RECRUITMENT]: [VIEW, CREATE, EDIT, DELETE, EXPORT, ASSIGN],
  [M.ONBOARDING]: [VIEW, CREATE, EDIT, APPROVE, ASSIGN],
  [M.OFFBOARDING]: [VIEW, CREATE, EDIT, APPROVE, ASSIGN],
  [M.ASSETS]: [VIEW, CREATE, EDIT, DELETE, ASSIGN, EXPORT],
  [M.HELPDESK]: [VIEW, CREATE, EDIT, DELETE, ASSIGN, APPROVE],
  [M.TRAINING]: [VIEW, CREATE, EDIT, DELETE, ASSIGN, EXPORT],

  // ── Shared Core ──────────────────────────────────────────────────
  [M.NOTIFICATIONS]: [VIEW, CREATE],
  [M.INBOX]: [VIEW, CREATE, EDIT],
  [M.FILES]: [VIEW, CREATE, DELETE],
  [M.AUDIT_LOGS]: [VIEW, EXPORT],
  [M.REPORTS]: [VIEW, EXPORT],
};

export class PermissionSeed {
  private readonly logger = new Logger(PermissionSeed.name);

  constructor(private readonly permissionModel: Model<Permission>) {}

  async run(): Promise<void> {
    this.logger.log('Seeding permissions...');

    const permissions = this.buildPermissionCatalog();

    for (const p of permissions) {
      await this.permissionModel.updateOne(
        { key: p.key },
        { $setOnInsert: p },
        { upsert: true },
      );
    }

    this.logger.log(
      `Permissions seeded successfully. Total: ${permissions.length}`,
    );
  }

  private buildPermissionCatalog(): Partial<Permission>[] {
    const permissions: Partial<Permission>[] = [];

    for (const [module, actions] of Object.entries(PERMISSION_CATALOG)) {
      for (const action of actions) {
        permissions.push({
          module,
          action,
          key: `${module}.${action}`,
          isActive: true,
        });
      }
    }

    return permissions;
  }
}

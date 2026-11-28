import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { Permission } from '../../../modules/permissions/schemas/permission.schema';
import {
  PermissionAction,
  PermissionModule,
} from '../../../modules/permissions/constants/permission.constant';

const {
  VIEW,
  CREATE,
  EDIT,
  DELETE,
  EXPORT,
  APPROVE,
  ASSIGN,
  REJECT,
  APPLY,
  ALLOCATE,
  ADJUST,
  CARRY_FORWARD,
  CLAIM,
  REVIEW,
  CANCEL_OWN,
  VIEW_OWN,
  VIEW_TEAM,
  VIEW_ORGANIZATION,
  VIEW_PENDING_APPROVALS,
  VIEW_OWN_TRANSACTIONS,
  VIEW_TEAM_TRANSACTIONS,
} = PermissionAction;
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
  [M.WORK_SCHEDULES]: [VIEW, CREATE, EDIT, DELETE],

  // ── CRM ──────────────────────────────────────────────────────────
  [M.LEADS]: [VIEW, CREATE, EDIT, DELETE, EXPORT, ASSIGN],
  [M.CONTACTS]: [VIEW, CREATE, EDIT, DELETE, EXPORT, ASSIGN],
  [M.COMPANIES]: [VIEW, CREATE, EDIT, DELETE, EXPORT, ASSIGN],
  [M.DEALS]: [VIEW, CREATE, EDIT, DELETE, EXPORT, APPROVE, ASSIGN],
  [M.TASKS]: [VIEW, CREATE, EDIT, DELETE, ASSIGN],
  [M.ACTIVITIES]: [VIEW, CREATE, EDIT, DELETE],
  [M.PRODUCTS]: [VIEW, CREATE, EDIT, DELETE],
  [M.QUOTATIONS]: [VIEW, CREATE, EDIT, DELETE, EXPORT, APPROVE],

  // ── HR ───────────────────────────────────────────────────────────
  [M.EMPLOYEES]: [VIEW, CREATE, EDIT, DELETE, EXPORT, ASSIGN],
  [M.ATTENDANCE]: [VIEW, CREATE, EDIT, DELETE, APPROVE, EXPORT],
  [M.LEAVES]: [VIEW, CREATE, EDIT, DELETE, APPROVE, EXPORT],
  [M.LEAVE_TYPES]: [VIEW, CREATE, EDIT, DELETE],
  [M.HOLIDAYS]: [VIEW, CREATE, EDIT, DELETE],
  [M.LEAVE_BALANCES]: [
    VIEW_OWN,
    VIEW_TEAM,
    ALLOCATE,
    ADJUST,
    CARRY_FORWARD,
    VIEW_OWN_TRANSACTIONS,
    VIEW_TEAM_TRANSACTIONS,
  ],
  [M.LEAVE_REQUESTS]: [
    APPLY,
    VIEW_OWN,
    VIEW_PENDING_APPROVALS,
    VIEW_TEAM,
    VIEW,
    APPROVE,
    REJECT,
    CANCEL_OWN,
    EDIT,
  ],
  [M.LEAVE_CALENDAR]: [VIEW_OWN, VIEW_TEAM, VIEW_ORGANIZATION],
  [M.COMP_OFF]: [CLAIM, VIEW_OWN, VIEW_TEAM, VIEW, REVIEW],
  [M.PERFORMANCE]: [VIEW, CREATE, EDIT, APPROVE, EXPORT],
  [M.EXPENSES]: [VIEW, CREATE, EDIT, DELETE, APPROVE, EXPORT],
  [M.TRAVEL]: [VIEW, CREATE, EDIT, DELETE, APPROVE, EXPORT],

  // ── Payroll / Tax ────────────────────────────────────────────────
  [M.SALARY]: [VIEW, CREATE, EDIT, EXPORT],
  [M.SALARY_COMPONENTS]: [VIEW, CREATE, EDIT, DELETE],
  [M.SALARY_STRUCTURES]: [VIEW, CREATE, EDIT, DELETE],
  [M.EMPLOYEE_SALARIES]: [VIEW, ASSIGN],
  [M.PAYROLL]: [VIEW, CREATE, EDIT, APPROVE, EXPORT],
  [M.PAYROLL_SETTINGS]: [VIEW, EDIT],
  [M.PAYROLL_CALCULATIONS]: [VIEW, CREATE],
  [M.PAYSLIPS]: [VIEW, VIEW_OWN, CREATE, EXPORT],
  [M.PAYROLL_HISTORY]: [VIEW, VIEW_OWN],
  [M.PAYROLL_REPORTS]: [VIEW, EXPORT],
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

export const GRANULAR_LEAVE_PERMISSIONS: Array<{
  module: string;
  action: string;
  key: string;
}> = [
  M.LEAVE_TYPES,
  M.HOLIDAYS,
  M.LEAVE_BALANCES,
  M.LEAVE_REQUESTS,
  M.LEAVE_CALENDAR,
  M.COMP_OFF,
].flatMap((mod) =>
  PERMISSION_CATALOG[mod].map((action) => ({
    module: mod,
    action,
    key: `${mod}.${action}`,
  })),
);

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

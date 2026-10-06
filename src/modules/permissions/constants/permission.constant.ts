export enum PermissionAction {
  VIEW = 'view',
  CREATE = 'create',
  EDIT = 'edit',
  DELETE = 'delete',
  EXPORT = 'export',
  APPROVE = 'approve',
  ASSIGN = 'assign',
}

export enum PermissionModule {
  // Core
  USERS = 'users',
  ROLES = 'roles',
  PERMISSIONS = 'permissions',

  // Organization
  DEPARTMENTS = 'departments',
  TEAMS = 'teams',
  DESIGNATIONS = 'designations',
  BRANCHES = 'branches',

  // CRM
  LEADS = 'leads',
  CONTACTS = 'contacts',
  COMPANIES = 'companies',
  DEALS = 'deals',
  TASKS = 'tasks',
  ACTIVITIES = 'activities',
  PRODUCTS = 'products',
  QUOTATIONS = 'quotations',

  // HR
  EMPLOYEES = 'employees',
  ATTENDANCE = 'attendance',
  LEAVES = 'leaves',
  PERFORMANCE = 'performance',
  EXPENSES = 'expenses',
  TRAVEL = 'travel',

  // Payroll / Tax
  SALARY = 'salary',
  PAYROLL = 'payroll',
  PAYSLIPS = 'payslips',
  TAX = 'tax',

  // Recruitment / HR Operations
  RECRUITMENT = 'recruitment',
  ONBOARDING = 'onboarding',
  OFFBOARDING = 'offboarding',
  ASSETS = 'assets',
  HELPDESK = 'helpdesk',
  TRAINING = 'training',

  // Shared Core
  NOTIFICATIONS = 'notifications',
  INBOX = 'inbox',
  FILES = 'files',
  AUDIT_LOGS = 'audit_logs',
  REPORTS = 'reports',
}

export const PermissionKey = {
  of: (module: PermissionModule, action: PermissionAction): string =>
    `${module}.${action}`,
} as const;

export const PermissionKeys = {
  // Users
  USERS_ASSIGN: PermissionKey.of(
    PermissionModule.USERS,
    PermissionAction.ASSIGN,
  ),
  USERS_VIEW: PermissionKey.of(PermissionModule.USERS, PermissionAction.VIEW),
  USERS_CREATE: PermissionKey.of(
    PermissionModule.USERS,
    PermissionAction.CREATE,
  ),
  USERS_EDIT: PermissionKey.of(PermissionModule.USERS, PermissionAction.EDIT),
  USERS_DELETE: PermissionKey.of(
    PermissionModule.USERS,
    PermissionAction.DELETE,
  ),

  // Roles
  ROLES_VIEW: PermissionKey.of(PermissionModule.ROLES, PermissionAction.VIEW),
  ROLES_CREATE: PermissionKey.of(
    PermissionModule.ROLES,
    PermissionAction.CREATE,
  ),
  ROLES_EDIT: PermissionKey.of(PermissionModule.ROLES, PermissionAction.EDIT),
  ROLES_DELETE: PermissionKey.of(
    PermissionModule.ROLES,
    PermissionAction.DELETE,
  ),

  // Employees
  EMPLOYEES_VIEW: PermissionKey.of(
    PermissionModule.EMPLOYEES,
    PermissionAction.VIEW,
  ),
  EMPLOYEES_CREATE: PermissionKey.of(
    PermissionModule.EMPLOYEES,
    PermissionAction.CREATE,
  ),
  EMPLOYEES_EDIT: PermissionKey.of(
    PermissionModule.EMPLOYEES,
    PermissionAction.EDIT,
  ),
  EMPLOYEES_DELETE: PermissionKey.of(
    PermissionModule.EMPLOYEES,
    PermissionAction.DELETE,
  ),
} as const;

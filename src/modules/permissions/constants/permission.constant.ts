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

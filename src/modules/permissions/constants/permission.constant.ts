export enum PermissionAction {
  VIEW = 'view',
  CREATE = 'create',
  EDIT = 'edit',
  DELETE = 'delete',
  EXPORT = 'export',
  APPROVE = 'approve',
  ASSIGN = 'assign',
  REJECT = 'reject',
  APPLY = 'apply',
  ALLOCATE = 'allocate',
  ADJUST = 'adjust',
  CARRY_FORWARD = 'carry_forward',
  CLAIM = 'claim',
  REVIEW = 'review',
  CANCEL_OWN = 'cancel_own',
  VIEW_OWN = 'view_own',
  VIEW_TEAM = 'view_team',
  VIEW_ORGANIZATION = 'view_organization',
  VIEW_PENDING_APPROVALS = 'view_pending_approvals',
  VIEW_OWN_TRANSACTIONS = 'view_own_transactions',
  VIEW_TEAM_TRANSACTIONS = 'view_team_transactions',
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
  WORK_SCHEDULES = 'work_schedules',

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
  LEAVE_TYPES = 'leave_types',
  HOLIDAYS = 'holidays',
  LEAVE_BALANCES = 'leave_balances',
  LEAVE_REQUESTS = 'leave_requests',
  LEAVE_CALENDAR = 'leave_calendar',
  COMP_OFF = 'comp_off',
  PERFORMANCE = 'performance',
  EXPENSES = 'expenses',
  TRAVEL = 'travel',

  // Payroll / Tax
  SALARY = 'salary',
  SALARY_COMPONENTS = 'salary.components',
  SALARY_STRUCTURES = 'salary.structures',
  EMPLOYEE_SALARIES = 'employee.salaries',
  PAYROLL = 'payroll',
  PAYROLL_SETTINGS = 'payroll.settings',
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

  // Work Schedules
  WORK_SCHEDULES_VIEW: PermissionKey.of(
    PermissionModule.WORK_SCHEDULES,
    PermissionAction.VIEW,
  ),
  WORK_SCHEDULES_CREATE: PermissionKey.of(
    PermissionModule.WORK_SCHEDULES,
    PermissionAction.CREATE,
  ),
  WORK_SCHEDULES_EDIT: PermissionKey.of(
    PermissionModule.WORK_SCHEDULES,
    PermissionAction.EDIT,
  ),
  WORK_SCHEDULES_DELETE: PermissionKey.of(
    PermissionModule.WORK_SCHEDULES,
    PermissionAction.DELETE,
  ),

  // Attendance
  ATTENDANCE_VIEW: PermissionKey.of(
    PermissionModule.ATTENDANCE,
    PermissionAction.VIEW,
  ),
  ATTENDANCE_CREATE: PermissionKey.of(
    PermissionModule.ATTENDANCE,
    PermissionAction.CREATE,
  ),
  ATTENDANCE_EDIT: PermissionKey.of(
    PermissionModule.ATTENDANCE,
    PermissionAction.EDIT,
  ),
  ATTENDANCE_DELETE: PermissionKey.of(
    PermissionModule.ATTENDANCE,
    PermissionAction.DELETE,
  ),
  ATTENDANCE_APPROVE: PermissionKey.of(
    PermissionModule.ATTENDANCE,
    PermissionAction.APPROVE,
  ),
  ATTENDANCE_EXPORT: PermissionKey.of(
    PermissionModule.ATTENDANCE,
    PermissionAction.EXPORT,
  ),

  // Leaves (Legacy / Broad)
  LEAVES_VIEW: PermissionKey.of(PermissionModule.LEAVES, PermissionAction.VIEW),
  LEAVES_CREATE: PermissionKey.of(
    PermissionModule.LEAVES,
    PermissionAction.CREATE,
  ),
  LEAVES_EDIT: PermissionKey.of(PermissionModule.LEAVES, PermissionAction.EDIT),
  LEAVES_DELETE: PermissionKey.of(
    PermissionModule.LEAVES,
    PermissionAction.DELETE,
  ),
  LEAVES_APPROVE: PermissionKey.of(
    PermissionModule.LEAVES,
    PermissionAction.APPROVE,
  ),
  LEAVES_EXPORT: PermissionKey.of(
    PermissionModule.LEAVES,
    PermissionAction.EXPORT,
  ),

  // Granular Leave Types
  LEAVE_TYPES_CREATE: PermissionKey.of(
    PermissionModule.LEAVE_TYPES,
    PermissionAction.CREATE,
  ),
  LEAVE_TYPES_VIEW: PermissionKey.of(
    PermissionModule.LEAVE_TYPES,
    PermissionAction.VIEW,
  ),
  LEAVE_TYPES_EDIT: PermissionKey.of(
    PermissionModule.LEAVE_TYPES,
    PermissionAction.EDIT,
  ),
  LEAVE_TYPES_DELETE: PermissionKey.of(
    PermissionModule.LEAVE_TYPES,
    PermissionAction.DELETE,
  ),

  // Granular Holidays
  HOLIDAYS_CREATE: PermissionKey.of(
    PermissionModule.HOLIDAYS,
    PermissionAction.CREATE,
  ),
  HOLIDAYS_VIEW: PermissionKey.of(
    PermissionModule.HOLIDAYS,
    PermissionAction.VIEW,
  ),
  HOLIDAYS_EDIT: PermissionKey.of(
    PermissionModule.HOLIDAYS,
    PermissionAction.EDIT,
  ),
  HOLIDAYS_DELETE: PermissionKey.of(
    PermissionModule.HOLIDAYS,
    PermissionAction.DELETE,
  ),

  // Granular Leave Balances & Ledger
  LEAVE_BALANCES_VIEW_OWN: PermissionKey.of(
    PermissionModule.LEAVE_BALANCES,
    PermissionAction.VIEW_OWN,
  ),
  LEAVE_BALANCES_VIEW_TEAM: PermissionKey.of(
    PermissionModule.LEAVE_BALANCES,
    PermissionAction.VIEW_TEAM,
  ),
  LEAVE_BALANCES_ALLOCATE: PermissionKey.of(
    PermissionModule.LEAVE_BALANCES,
    PermissionAction.ALLOCATE,
  ),
  LEAVE_BALANCES_ADJUST: PermissionKey.of(
    PermissionModule.LEAVE_BALANCES,
    PermissionAction.ADJUST,
  ),
  LEAVE_BALANCES_CARRY_FORWARD: PermissionKey.of(
    PermissionModule.LEAVE_BALANCES,
    PermissionAction.CARRY_FORWARD,
  ),
  LEAVE_BALANCES_VIEW_OWN_TRANSACTIONS: PermissionKey.of(
    PermissionModule.LEAVE_BALANCES,
    PermissionAction.VIEW_OWN_TRANSACTIONS,
  ),
  LEAVE_BALANCES_VIEW_TEAM_TRANSACTIONS: PermissionKey.of(
    PermissionModule.LEAVE_BALANCES,
    PermissionAction.VIEW_TEAM_TRANSACTIONS,
  ),

  // Granular Leave Requests & Approvals
  LEAVE_REQUESTS_APPLY: PermissionKey.of(
    PermissionModule.LEAVE_REQUESTS,
    PermissionAction.APPLY,
  ),
  LEAVE_REQUESTS_VIEW_OWN: PermissionKey.of(
    PermissionModule.LEAVE_REQUESTS,
    PermissionAction.VIEW_OWN,
  ),
  LEAVE_REQUESTS_VIEW_PENDING_APPROVALS: PermissionKey.of(
    PermissionModule.LEAVE_REQUESTS,
    PermissionAction.VIEW_PENDING_APPROVALS,
  ),
  LEAVE_REQUESTS_VIEW_TEAM: PermissionKey.of(
    PermissionModule.LEAVE_REQUESTS,
    PermissionAction.VIEW_TEAM,
  ),
  LEAVE_REQUESTS_VIEW: PermissionKey.of(
    PermissionModule.LEAVE_REQUESTS,
    PermissionAction.VIEW,
  ),
  LEAVE_REQUESTS_APPROVE: PermissionKey.of(
    PermissionModule.LEAVE_REQUESTS,
    PermissionAction.APPROVE,
  ),
  LEAVE_REQUESTS_REJECT: PermissionKey.of(
    PermissionModule.LEAVE_REQUESTS,
    PermissionAction.REJECT,
  ),
  LEAVE_REQUESTS_CANCEL_OWN: PermissionKey.of(
    PermissionModule.LEAVE_REQUESTS,
    PermissionAction.CANCEL_OWN,
  ),
  LEAVE_REQUESTS_EDIT: PermissionKey.of(
    PermissionModule.LEAVE_REQUESTS,
    PermissionAction.EDIT,
  ),

  // Granular Leave Calendar
  LEAVE_CALENDAR_VIEW_OWN: PermissionKey.of(
    PermissionModule.LEAVE_CALENDAR,
    PermissionAction.VIEW_OWN,
  ),
  LEAVE_CALENDAR_VIEW_TEAM: PermissionKey.of(
    PermissionModule.LEAVE_CALENDAR,
    PermissionAction.VIEW_TEAM,
  ),
  LEAVE_CALENDAR_VIEW_ORGANIZATION: PermissionKey.of(
    PermissionModule.LEAVE_CALENDAR,
    PermissionAction.VIEW_ORGANIZATION,
  ),

  // Granular Compensatory Off (Comp-Off)
  COMP_OFF_CLAIM: PermissionKey.of(
    PermissionModule.COMP_OFF,
    PermissionAction.CLAIM,
  ),
  COMP_OFF_VIEW_OWN: PermissionKey.of(
    PermissionModule.COMP_OFF,
    PermissionAction.VIEW_OWN,
  ),
  COMP_OFF_VIEW_TEAM: PermissionKey.of(
    PermissionModule.COMP_OFF,
    PermissionAction.VIEW_TEAM,
  ),
  COMP_OFF_VIEW: PermissionKey.of(
    PermissionModule.COMP_OFF,
    PermissionAction.VIEW,
  ),
  COMP_OFF_REVIEW: PermissionKey.of(
    PermissionModule.COMP_OFF,
    PermissionAction.REVIEW,
  ),

  EMPLOYEES_ASSIGN: PermissionKey.of(
    PermissionModule.EMPLOYEES,
    PermissionAction.ASSIGN,
  ),

  // Leads
  LEADS_VIEW: PermissionKey.of(PermissionModule.LEADS, PermissionAction.VIEW),
  LEADS_CREATE: PermissionKey.of(
    PermissionModule.LEADS,
    PermissionAction.CREATE,
  ),
  LEADS_EDIT: PermissionKey.of(PermissionModule.LEADS, PermissionAction.EDIT),
  LEADS_DELETE: PermissionKey.of(
    PermissionModule.LEADS,
    PermissionAction.DELETE,
  ),
  LEADS_ASSIGN: PermissionKey.of(
    PermissionModule.LEADS,
    PermissionAction.ASSIGN,
  ),
  LEADS_EXPORT: PermissionKey.of(
    PermissionModule.LEADS,
    PermissionAction.EXPORT,
  ),

  // Companies
  COMPANIES_VIEW: PermissionKey.of(
    PermissionModule.COMPANIES,
    PermissionAction.VIEW,
  ),
  COMPANIES_CREATE: PermissionKey.of(
    PermissionModule.COMPANIES,
    PermissionAction.CREATE,
  ),
  COMPANIES_EDIT: PermissionKey.of(
    PermissionModule.COMPANIES,
    PermissionAction.EDIT,
  ),
  COMPANIES_DELETE: PermissionKey.of(
    PermissionModule.COMPANIES,
    PermissionAction.DELETE,
  ),
  COMPANIES_ASSIGN: PermissionKey.of(
    PermissionModule.COMPANIES,
    PermissionAction.ASSIGN,
  ),
  COMPANIES_EXPORT: PermissionKey.of(
    PermissionModule.COMPANIES,
    PermissionAction.EXPORT,
  ),

  // Contacts
  CONTACTS_VIEW: PermissionKey.of(
    PermissionModule.CONTACTS,
    PermissionAction.VIEW,
  ),
  CONTACTS_CREATE: PermissionKey.of(
    PermissionModule.CONTACTS,
    PermissionAction.CREATE,
  ),
  CONTACTS_EDIT: PermissionKey.of(
    PermissionModule.CONTACTS,
    PermissionAction.EDIT,
  ),
  CONTACTS_DELETE: PermissionKey.of(
    PermissionModule.CONTACTS,
    PermissionAction.DELETE,
  ),
  CONTACTS_ASSIGN: PermissionKey.of(
    PermissionModule.CONTACTS,
    PermissionAction.ASSIGN,
  ),
  CONTACTS_EXPORT: PermissionKey.of(
    PermissionModule.CONTACTS,
    PermissionAction.EXPORT,
  ),

  // Deals
  DEALS_VIEW: PermissionKey.of(PermissionModule.DEALS, PermissionAction.VIEW),
  DEALS_CREATE: PermissionKey.of(
    PermissionModule.DEALS,
    PermissionAction.CREATE,
  ),
  DEALS_EDIT: PermissionKey.of(PermissionModule.DEALS, PermissionAction.EDIT),
  DEALS_DELETE: PermissionKey.of(
    PermissionModule.DEALS,
    PermissionAction.DELETE,
  ),
  DEALS_ASSIGN: PermissionKey.of(
    PermissionModule.DEALS,
    PermissionAction.ASSIGN,
  ),
  DEALS_APPROVE: PermissionKey.of(
    PermissionModule.DEALS,
    PermissionAction.APPROVE,
  ),
  DEALS_EXPORT: PermissionKey.of(
    PermissionModule.DEALS,
    PermissionAction.EXPORT,
  ),

  // Tasks
  TASKS_VIEW: PermissionKey.of(PermissionModule.TASKS, PermissionAction.VIEW),
  TASKS_CREATE: PermissionKey.of(
    PermissionModule.TASKS,
    PermissionAction.CREATE,
  ),
  TASKS_EDIT: PermissionKey.of(PermissionModule.TASKS, PermissionAction.EDIT),
  TASKS_DELETE: PermissionKey.of(
    PermissionModule.TASKS,
    PermissionAction.DELETE,
  ),
  TASKS_ASSIGN: PermissionKey.of(
    PermissionModule.TASKS,
    PermissionAction.ASSIGN,
  ),

  // Activities
  ACTIVITIES_VIEW: PermissionKey.of(
    PermissionModule.ACTIVITIES,
    PermissionAction.VIEW,
  ),
  ACTIVITIES_CREATE: PermissionKey.of(
    PermissionModule.ACTIVITIES,
    PermissionAction.CREATE,
  ),
  ACTIVITIES_EDIT: PermissionKey.of(
    PermissionModule.ACTIVITIES,
    PermissionAction.EDIT,
  ),
  ACTIVITIES_DELETE: PermissionKey.of(
    PermissionModule.ACTIVITIES,
    PermissionAction.DELETE,
  ),

  // Products & Services
  PRODUCTS_VIEW: PermissionKey.of(
    PermissionModule.PRODUCTS,
    PermissionAction.VIEW,
  ),
  PRODUCTS_CREATE: PermissionKey.of(
    PermissionModule.PRODUCTS,
    PermissionAction.CREATE,
  ),
  PRODUCTS_EDIT: PermissionKey.of(
    PermissionModule.PRODUCTS,
    PermissionAction.EDIT,
  ),
  PRODUCTS_DELETE: PermissionKey.of(
    PermissionModule.PRODUCTS,
    PermissionAction.DELETE,
  ),

  // Quotations
  QUOTES_VIEW: PermissionKey.of(
    PermissionModule.QUOTATIONS,
    PermissionAction.VIEW,
  ),
  QUOTES_CREATE: PermissionKey.of(
    PermissionModule.QUOTATIONS,
    PermissionAction.CREATE,
  ),
  QUOTES_EDIT: PermissionKey.of(
    PermissionModule.QUOTATIONS,
    PermissionAction.EDIT,
  ),
  QUOTES_DELETE: PermissionKey.of(
    PermissionModule.QUOTATIONS,
    PermissionAction.DELETE,
  ),
  QUOTES_APPROVE: PermissionKey.of(
    PermissionModule.QUOTATIONS,
    PermissionAction.APPROVE,
  ),
  QUOTES_EXPORT: PermissionKey.of(
    PermissionModule.QUOTATIONS,
    PermissionAction.EXPORT,
  ),

  // Reports
  REPORTS_VIEW: PermissionKey.of(
    PermissionModule.REPORTS,
    PermissionAction.VIEW,
  ),
  REPORTS_EXPORT: PermissionKey.of(
    PermissionModule.REPORTS,
    PermissionAction.EXPORT,
  ),

  // Salary Components
  SALARY_COMPONENTS_VIEW: PermissionKey.of(
    PermissionModule.SALARY_COMPONENTS,
    PermissionAction.VIEW,
  ),
  SALARY_COMPONENTS_CREATE: PermissionKey.of(
    PermissionModule.SALARY_COMPONENTS,
    PermissionAction.CREATE,
  ),
  SALARY_COMPONENTS_EDIT: PermissionKey.of(
    PermissionModule.SALARY_COMPONENTS,
    PermissionAction.EDIT,
  ),
  SALARY_COMPONENTS_DELETE: PermissionKey.of(
    PermissionModule.SALARY_COMPONENTS,
    PermissionAction.DELETE,
  ),

  // Salary Structures
  SALARY_STRUCTURES_VIEW: PermissionKey.of(
    PermissionModule.SALARY_STRUCTURES,
    PermissionAction.VIEW,
  ),
  SALARY_STRUCTURES_CREATE: PermissionKey.of(
    PermissionModule.SALARY_STRUCTURES,
    PermissionAction.CREATE,
  ),
  SALARY_STRUCTURES_EDIT: PermissionKey.of(
    PermissionModule.SALARY_STRUCTURES,
    PermissionAction.EDIT,
  ),
  SALARY_STRUCTURES_DELETE: PermissionKey.of(
    PermissionModule.SALARY_STRUCTURES,
    PermissionAction.DELETE,
  ),

  // Employee Salaries
  EMPLOYEE_SALARIES_VIEW: PermissionKey.of(
    PermissionModule.EMPLOYEE_SALARIES,
    PermissionAction.VIEW,
  ),
  EMPLOYEE_SALARIES_ASSIGN: PermissionKey.of(
    PermissionModule.EMPLOYEE_SALARIES,
    PermissionAction.ASSIGN,
  ),

  // Payroll Configuration
  PAYROLL_SETTINGS_VIEW: PermissionKey.of(
    PermissionModule.PAYROLL_SETTINGS,
    PermissionAction.VIEW,
  ),
  PAYROLL_SETTINGS_EDIT: PermissionKey.of(
    PermissionModule.PAYROLL_SETTINGS,
    PermissionAction.EDIT,
  ),
} as const;

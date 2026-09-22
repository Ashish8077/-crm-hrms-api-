export enum AuditAction {
  ROLE_CREATED = 'ROLE_CREATED',
  ROLE_UPDATED = 'ROLE_UPDATED',
  ROLE_STATUS_CHANGED = 'ROLE_STATUS_CHANGED',
  ROLE_DELETED = 'ROLE_DELETED',
  USER_ROLES_ASSIGNED = 'USER_ROLES_ASSIGNED',
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  REFRESH_SUCCESS = 'REFRESH_SUCCESS',
  REFRESH_FAILURE = 'REFRESH_FAILURE',
  LOGOUT_SUCCESS = 'LOGOUT_SUCCESS',
  LOGOUT_FAILURE = 'LOGOUT_FAILURE',
  // Extensible for future actions...
}

export enum AuditTargetModel {
  ROLE = 'Role',
  USER = 'User',
}

export enum AuditLogFailureReason {
  INVALID_CREDENTIALS = 'invalid_credentials',
  ACCOUNT_INACTIVE = 'account_inactive',
  ACCOUNT_LOCKED_OUT = 'account_locked_out',
  INVALID_REFRESH_TOKEN = 'invalid_refresh_token',
  REFRESH_TOKEN_REUSE = 'refresh_token_reuse',
}

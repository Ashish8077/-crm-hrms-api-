/** Number of milliseconds in a second. */
export const MILLISECONDS_PER_SECOND = 1000;

/** Number of milliseconds in a day. */
export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * MILLISECONDS_PER_SECOND;

/** Default number of days for refresh token expiry. */
export const DEFAULT_REFRESH_TOKEN_EXPIRY_DAYS = 7;

/** Number of failed login attempts before temporary lockout. */
export const LOGIN_LOCKOUT_THRESHOLD = 5;

/** Duration of temporary lockout in seconds. */
export const LOGIN_LOCKOUT_DURATION_SECONDS = 15 * 60;

/** Window for counting failed attempts in seconds. */
export const LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;

/** Cookie names. */
export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/** Redis key prefixes for login security. */
export const REDIS_LOGIN_ATTEMPTS_PREFIX = 'login_attempts:';
export const REDIS_LOGIN_LOCKOUT_PREFIX = 'login_lockout:';

/** Audit log actions. */
export enum AuditLogAction {
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
}

/** Audit log failure reasons. */
export enum AuditLogFailureReason {
  INVALID_CREDENTIALS = 'invalid_credentials',
  ACCOUNT_INACTIVE = 'account_inactive',
  ACCOUNT_LOCKED_OUT = 'account_locked_out',
}

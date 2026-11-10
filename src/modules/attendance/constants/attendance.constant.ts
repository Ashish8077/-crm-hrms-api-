// 1. WHERE the employee is working (Controls Geofence vs IP vs WFH approval checks)
export enum WorkMode {
  OFFICE = 'OFFICE',
  WORK_FROM_HOME = 'WORK_FROM_HOME',
  ON_DUTY = 'ON_DUTY', // Field work / Client site visit
}

// 2. HOW the attendance was logged (Controls IP vs GPS vs Manual audit rules)
export enum AttendanceSource {
  WEB = 'WEB',
  MOBILE = 'MOBILE',
  BIOMETRIC = 'BIOMETRIC',
  REGULARIZED = 'REGULARIZED',
  ADMIN_MANUAL = 'ADMIN_MANUAL',
  SYSTEM = 'SYSTEM',
}

export { AttendanceSource as PunchSource };

// 3. WHAT the daily status is for payroll (Calculated by server)
export enum AttendanceStatus {
  CHECKED_IN = 'CHECKED_IN',
  ON_BREAK = 'ON_BREAK',
  PRESENT = 'PRESENT',
  LATE = 'LATE',
  HALF_DAY = 'HALF_DAY',
  ABSENT = 'ABSENT',
  ON_LEAVE = 'ON_LEAVE',
  WEEK_OFF = 'WEEK_OFF',
  HOLIDAY = 'HOLIDAY',
  INCOMPLETE = 'INCOMPLETE',
  REGULARIZED = 'REGULARIZED',
}

export enum BreakType {
  LUNCH = 'LUNCH',
  TEA = 'TEA',
  PERSONAL = 'PERSONAL',
  OTHER = 'OTHER',
}

export enum RegularizationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum RegularizationType {
  TIME_CORRECTION = 'TIME_CORRECTION',
  FORGOT_PUNCH = 'FORGOT_PUNCH',
  ON_DUTY = 'ON_DUTY',
}

export const ATTENDANCE_CONSTANTS = {
  DEFAULT_TIMEZONE: 'Asia/Kolkata',

  // Shift string lengths
  SHIFT_NAME_MIN_LENGTH: 2,
  SHIFT_NAME_MAX_LENGTH: 100,
  SHIFT_CODE_MIN_LENGTH: 2,
  SHIFT_CODE_MAX_LENGTH: 20,

  // Late arrival
  DEFAULT_GRACE_PERIOD_MINUTES: 15,
  MIN_GRACE_PERIOD_MINUTES: 0,
  MAX_GRACE_PERIOD_MINUTES: 60,

  // Attendance classification
  DEFAULT_FULL_DAY_MINUTES: 480, // 8 hours
  MIN_FULL_DAY_MINUTES: 60, // 1 hour
  MAX_FULL_DAY_MINUTES: 720, // 12 hours

  DEFAULT_HALF_DAY_MINUTES: 240, // 4 hours
  MIN_HALF_DAY_MINUTES: 30, // 30 minutes
  MAX_HALF_DAY_MINUTES: 480, // 8 hours

  DEFAULT_BREAK_DURATION_MINUTES: 60, // 1 hour
  MIN_BREAK_DURATION_MINUTES: 0,
  MAX_BREAK_DURATION_MINUTES: 180, // 3 hours

  // Overtime
  DEFAULT_OVERTIME_THRESHOLD_MINUTES: 480, // 8 hours
  MIN_OVERTIME_THRESHOLD_MINUTES: 0,
  MAX_OVERTIME_THRESHOLD_MINUTES: 720, // 12 hours

  MAX_BREAKS_PER_DAY: 3,

  // Multi-punch cooldown guard (anti-double-tap)
  PUNCH_COOLDOWN_SECONDS: 60,

  // Attendance Regularization Guards (SLA / Payroll Lockout Window)
  REGULARIZATION_MAX_PAST_DAYS: 7,
} as const;

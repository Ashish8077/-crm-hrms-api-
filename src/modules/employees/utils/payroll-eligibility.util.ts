import { AttendanceCalculationUtil } from '../../attendance/utils/attendance-calculation.util';
import {
  ActiveEmploymentStatuses,
  EmploymentStatus,
} from '../constants/employee.constant';

export const PAYROLL_ELIGIBLE_SEPARATED_STATUSES: ReadonlyArray<EmploymentStatus> =
  [EmploymentStatus.RESIGNED, EmploymentStatus.TERMINATED];

export type PayrollIneligibilityReason =
  | 'SOFT_DELETED'
  | 'UNSUPPORTED_EMPLOYMENT_STATUS'
  | 'MISSING_JOINING_DATE'
  | 'JOINED_AFTER_PERIOD'
  | 'MISSING_RELIABLE_EXIT_DATE'
  | 'EXITED_BEFORE_PERIOD'
  | 'INVALID_TENURE_WINDOW';

export interface PayrollPeriodEligibilityInput {
  deletedAt?: Date | null;
  employmentStatus: EmploymentStatus;
  dateOfJoining?: Date | null;
  lastWorkingDate?: Date | null;
  terminationDate?: Date | null;
}

export type PayrollPeriodEligibilityResult =
  | {
      eligible: true;
      dateOfJoiningStr: string;
      effectiveExitDateStr: string | null;
      effectiveStartStr: string;
      effectiveEndStr: string;
      effectiveTenureStart: Date;
      effectiveTenureEnd: Date;
      eligibleDays: number;
    }
  | {
      eligible: false;
      reason: PayrollIneligibilityReason;
      dateOfJoiningStr?: string;
      effectiveExitDateStr?: string | null;
    };

const MS_PER_DAY = 86_400_000;

/**
 * Resolves a stored Date to a canonical YYYY-MM-DD calendar string.
 * Date-only UTC midnight values preserve their calendar date across negative UTC offsets;
 * non-midnight timestamps are resolved using the provided branch timezone (or UTC when omitted).
 */
export function resolvePayrollCalendarDate(
  dateValue: Date,
  branchTimezone?: string,
): string {
  if (
    dateValue.getUTCHours() === 0 &&
    dateValue.getUTCMinutes() === 0 &&
    dateValue.getUTCSeconds() === 0 &&
    dateValue.getUTCMilliseconds() === 0
  ) {
    return dateValue.toISOString().slice(0, 10);
  }
  return branchTimezone
    ? AttendanceCalculationUtil.getAttendanceDateString(
        dateValue,
        branchTimezone,
      )
    : dateValue.toISOString().slice(0, 10);
}

/**
 * Resolves the authoritative effective exit date strictly from explicit separation fields
 * (`lastWorkingDate` / `terminationDate`). Never falls back to `resignationDate` and never
 * guesses an exit date when unavailable.
 */
export function resolveAuthoritativePayrollExitDate(
  employee: Pick<
    PayrollPeriodEligibilityInput,
    'employmentStatus' | 'lastWorkingDate' | 'terminationDate'
  >,
): Date | null {
  const lastWorking = employee.lastWorkingDate ?? null;
  const terminated = employee.terminationDate ?? null;

  if (employee.employmentStatus === EmploymentStatus.TERMINATED) {
    if (lastWorking && terminated) {
      return lastWorking.getTime() < terminated.getTime()
        ? lastWorking
        : terminated;
    }
    return terminated ?? lastWorking ?? null;
  }

  return lastWorking ?? terminated ?? null;
}

/**
 * Single authoritative payroll-period employee eligibility and tenure resolver shared by
 * PayrollAttendanceSummaryService and PayrollInputResolver.
 */
export function evaluateEmployeePayrollPeriodEligibility(
  employee: PayrollPeriodEligibilityInput,
  periodStartStr: string,
  periodEndStr: string,
  branchTimezone?: string,
): PayrollPeriodEligibilityResult {
  if (employee.deletedAt !== undefined && employee.deletedAt !== null) {
    return { eligible: false, reason: 'SOFT_DELETED' };
  }

  const isActiveStatus = ActiveEmploymentStatuses.includes(
    employee.employmentStatus,
  );
  const isSeparatedStatus = PAYROLL_ELIGIBLE_SEPARATED_STATUSES.includes(
    employee.employmentStatus,
  );

  if (!isActiveStatus && !isSeparatedStatus) {
    return { eligible: false, reason: 'UNSUPPORTED_EMPLOYMENT_STATUS' };
  }

  if (!employee.dateOfJoining) {
    return { eligible: false, reason: 'MISSING_JOINING_DATE' };
  }

  const dateOfJoiningStr = resolvePayrollCalendarDate(
    employee.dateOfJoining,
    branchTimezone,
  );

  if (dateOfJoiningStr > periodEndStr) {
    return {
      eligible: false,
      reason: 'JOINED_AFTER_PERIOD',
      dateOfJoiningStr,
    };
  }

  const exitDateRaw = resolveAuthoritativePayrollExitDate(employee);

  if (isSeparatedStatus && !exitDateRaw) {
    return {
      eligible: false,
      reason: 'MISSING_RELIABLE_EXIT_DATE',
      dateOfJoiningStr,
      effectiveExitDateStr: null,
    };
  }

  let effectiveExitDateStr: string | null = null;
  if (exitDateRaw) {
    effectiveExitDateStr = resolvePayrollCalendarDate(
      exitDateRaw,
      branchTimezone,
    );

    if (effectiveExitDateStr < periodStartStr) {
      return {
        eligible: false,
        reason: 'EXITED_BEFORE_PERIOD',
        dateOfJoiningStr,
        effectiveExitDateStr,
      };
    }

    if (effectiveExitDateStr < dateOfJoiningStr) {
      return {
        eligible: false,
        reason: 'INVALID_TENURE_WINDOW',
        dateOfJoiningStr,
        effectiveExitDateStr,
      };
    }
  }

  const effectiveStartStr =
    dateOfJoiningStr > periodStartStr ? dateOfJoiningStr : periodStartStr;
  const effectiveEndStr =
    effectiveExitDateStr && effectiveExitDateStr < periodEndStr
      ? effectiveExitDateStr
      : periodEndStr;

  if (effectiveStartStr > effectiveEndStr) {
    return {
      eligible: false,
      reason: 'INVALID_TENURE_WINDOW',
      dateOfJoiningStr,
      effectiveExitDateStr,
    };
  }

  const effectiveTenureStart = new Date(`${effectiveStartStr}T00:00:00.000Z`);
  const effectiveTenureEnd = new Date(`${effectiveEndStr}T00:00:00.000Z`);
  const eligibleDays =
    Math.floor(
      (effectiveTenureEnd.getTime() - effectiveTenureStart.getTime()) /
        MS_PER_DAY,
    ) + 1;

  return {
    eligible: true,
    dateOfJoiningStr,
    effectiveExitDateStr,
    effectiveStartStr,
    effectiveEndStr,
    effectiveTenureStart,
    effectiveTenureEnd,
    eligibleDays,
  };
}

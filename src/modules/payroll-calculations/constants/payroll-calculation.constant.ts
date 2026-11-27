import { Types } from 'mongoose';
import { Decimal } from '../../../common/utils/financial-math.util';
import { PayrollRoundingMode } from '../../payroll-configuration/constants/payroll-configuration.constant';
import { PayrollPeriodStatus } from '../../payroll-periods/constants/payroll-period.constant';
import { normalizeEffectiveDate } from '../../employee-salaries/constants/employee-salary.constant';

export const PAYROLL_CALCULATION_ENGINE_VERSION = '1.0.0';

export const PAYROLL_PROCESSING_CONSTANTS = {
  DEFAULT_BATCH_SIZE: 50,
  MIN_BATCH_SIZE: 10,
  MAX_BATCH_SIZE: 200,
  MAX_CONCURRENT_WRITES_PER_BATCH: 10,
  LOCK_STALE_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes stale heartbeat recovery
  MAX_ERROR_MESSAGE_LENGTH: 300,
  MAX_LAST_ERROR_SUMMARY_LENGTH: 500,
  MAX_FAILURE_SAMPLE_IN_CONFLICT: 20,
} as const;

export enum PayrollRecordStatus {
  CALCULATED = 'CALCULATED',
  APPROVED = 'APPROVED',
  INVALIDATED = 'INVALIDATED',
}

export const ALLOWED_CALCULATION_PERIOD_STATUSES: ReadonlyArray<PayrollPeriodStatus> =
  [PayrollPeriodStatus.DRAFT, PayrollPeriodStatus.PROCESSING];

export const DECIMAL_ROUNDING_MODE_MAP: Record<
  PayrollRoundingMode,
  Decimal.Rounding
> = {
  [PayrollRoundingMode.HALF_EVEN]: Decimal.ROUND_HALF_EVEN,
  [PayrollRoundingMode.HALF_UP]: Decimal.ROUND_HALF_UP,
  [PayrollRoundingMode.HALF_DOWN]: Decimal.ROUND_HALF_DOWN,
  [PayrollRoundingMode.FLOOR]: Decimal.ROUND_FLOOR,
  [PayrollRoundingMode.CEIL]: Decimal.ROUND_CEIL,
};

/**
 * Rounds a Decimal value using the configured precision and rounding mode,
 * keeping the result as an exact Decimal (never converting to JS number).
 */
export function roundDecimal(
  value: Decimal,
  precision: number,
  mode: PayrollRoundingMode,
): Decimal {
  return value.toDecimalPlaces(precision, DECIMAL_ROUNDING_MODE_MAP[mode]);
}

/**
 * Converts a Decimal value into a MongoDB BSON Decimal128 formatted to exact fixed scale.
 */
export function toDecimal128(
  value: Decimal,
  precision: number,
): Types.Decimal128 {
  return Types.Decimal128.fromString(value.toFixed(precision));
}

/**
 * Converts a persisted Decimal128 (or string/Decimal) to an exact decimal string representation.
 */
export function decimal128ToString(
  value: Types.Decimal128 | Decimal | string | number,
): string {
  if (typeof value === 'string') return value;
  if (value instanceof Decimal) return value.toString();
  if (typeof value === 'number') return String(value);
  return value.toString();
}

const MS_PER_DAY = 86_400_000;

/**
 * Computes inclusive calendar days between period start and end dates in UTC.
 * Accurately handles 28, 29 (leap Feb), 30, and 31-day periods.
 */
export function calculateCalendarDaysInclusive(
  startDate: Date,
  endDate: Date,
): number {
  const normalizedStart = normalizeEffectiveDate(startDate);
  const normalizedEnd = normalizeEffectiveDate(endDate);
  return (
    Math.floor(
      (normalizedEnd.getTime() - normalizedStart.getTime()) / MS_PER_DAY,
    ) + 1
  );
}

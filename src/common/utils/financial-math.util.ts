import Decimal from 'decimal.js';

// Configure global Decimal precision and default rounding to Banker's Rounding (ROUND_HALF_EVEN)
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_EVEN,
});

/**
 * Creates a Decimal instance configured with Banker's Rounding.
 */
export function toDecimal(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

/**
 * Rounds a number or Decimal to the specified decimal places using Banker's Rounding (IEEE 754-2008 Half-Even).
 * In half-even rounding, values ending in .5 round to the nearest even digit.
 * e.g., 2.5 -> 2, 3.5 -> 4, 2.225 -> 2.22, 2.235 -> 2.24
 */
export function roundBankers(value: Decimal.Value, decimalPlaces = 2): number {
  return new Decimal(value)
    .toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_EVEN)
    .toNumber();
}

/**
 * Multiplies a base amount by a percentage (e.g. base = 1000, percent = 12 -> 120).
 */
export function computePercentage(
  base: Decimal.Value,
  percent: Decimal.Value,
): Decimal {
  return new Decimal(base).times(new Decimal(percent)).dividedBy(100);
}

/**
 * Compares two monetary amounts for equivalence within a tolerance threshold (default: 0.01).
 */
export function isMonetaryEqual(
  a: Decimal.Value,
  b: Decimal.Value,
  tolerance = 0.01,
): boolean {
  return new Decimal(a)
    .minus(new Decimal(b))
    .abs()
    .lessThanOrEqualTo(tolerance);
}

export { Decimal };

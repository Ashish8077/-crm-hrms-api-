import {
  computePercentage,
  isMonetaryEqual,
  roundBankers,
  toDecimal,
} from './financial-math.util';

describe("FinancialMathUtil - Banker's Rounding (ROUND_HALF_EVEN)", () => {
  it('correctly applies half-even rounding to nearest even digit', () => {
    // 2.225 ends in 5, preceding digit is 2 (even) -> rounds to 2.22
    expect(roundBankers(2.225, 2)).toBe(2.22);

    // 2.235 ends in 5, preceding digit is 3 (odd) -> rounds to 2.24 (even)
    expect(roundBankers(2.235, 2)).toBe(2.24);

    // 2.5 rounds to 2 (even)
    expect(roundBankers(2.5, 0)).toBe(2);

    // 3.5 rounds to 4 (even)
    expect(roundBankers(3.5, 0)).toBe(4);

    // Standard cases without tie
    expect(roundBankers(2.221, 2)).toBe(2.22);
    expect(roundBankers(2.229, 2)).toBe(2.23);
  });

  it('handles negative numbers with half-even rounding symmetrically', () => {
    expect(roundBankers(-2.225, 2)).toBe(-2.22);
    expect(roundBankers(-2.235, 2)).toBe(-2.24);
  });

  it('computes percentage with high precision', () => {
    // 12% of 15,000 = 1,800
    const result = computePercentage(15000, 12);
    expect(result.toNumber()).toBe(1800);

    // 3.25% of 37,477 = 1217.9975
    const esi = computePercentage(37477, 3.25);
    expect(roundBankers(esi, 2)).toBe(1218.0);
  });

  it('checks monetary equality within tolerance', () => {
    expect(isMonetaryEqual(100.0, 100.009, 0.01)).toBe(true);
    expect(isMonetaryEqual(100.0, 100.02, 0.01)).toBe(false);
  });

  it('converts to Decimal and avoids floating-point binary representation errors', () => {
    const a = toDecimal(0.1);
    const b = toDecimal(0.2);
    expect(a.plus(b).toNumber()).toBe(0.3);
  });
});

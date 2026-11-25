import {
  areEffectiveDateIntervalsOverlapping,
  normalizeEffectiveDate,
} from './employee-salary.constant';

describe('EmployeeSalary Date Utilities', () => {
  describe('normalizeEffectiveDate', () => {
    it('normalizes YYYY-MM-DD to UTC midnight date', () => {
      const result = normalizeEffectiveDate('2026-07-01');
      expect(result.toISOString()).toBe('2026-07-01T00:00:00.000Z');
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(6); // 0-indexed month
      expect(result.getUTCDate()).toBe(1);
      expect(result.getUTCHours()).toBe(0);
    });

    it('normalizes ISO string with local timezone to UTC date midnight', () => {
      const result = normalizeEffectiveDate('2026-07-01T15:30:00.000Z');
      expect(result.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    });

    it('normalizes Date instance to UTC date midnight', () => {
      const input = new Date('2026-10-15T23:59:59.999Z');
      const result = normalizeEffectiveDate(input);
      expect(result.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    });

    it('throws on invalid calendar date (e.g. Feb 30)', () => {
      expect(() => normalizeEffectiveDate('2026-02-30')).toThrow(
        'Invalid calendar date',
      );
    });

    it('throws on non-date string', () => {
      expect(() => normalizeEffectiveDate('invalid-date')).toThrow(
        'Invalid date format',
      );
    });
  });

  describe('areEffectiveDateIntervalsOverlapping', () => {
    it('returns false for adjacent contiguous intervals [A, B) and [B, null)', () => {
      const a = {
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-07-01T00:00:00.000Z'),
      };
      const b = {
        effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
        effectiveTo: null,
      };

      expect(areEffectiveDateIntervalsOverlapping(a, b)).toBe(false);
      expect(areEffectiveDateIntervalsOverlapping(b, a)).toBe(false);
    });

    it('returns true when intervals overlap by even one day', () => {
      const a = {
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-07-01T00:00:00.000Z'),
      };
      const b = {
        effectiveFrom: new Date('2026-06-30T00:00:00.000Z'),
        effectiveTo: null,
      };

      expect(areEffectiveDateIntervalsOverlapping(a, b)).toBe(true);
      expect(areEffectiveDateIntervalsOverlapping(b, a)).toBe(true);
    });

    it('returns true for two open-ended intervals', () => {
      const a = {
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
      };
      const b = {
        effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
        effectiveTo: null,
      };

      expect(areEffectiveDateIntervalsOverlapping(a, b)).toBe(true);
    });

    it('returns false for disjoint separated intervals', () => {
      const a = {
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-03-01T00:00:00.000Z'),
      };
      const b = {
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-06-01T00:00:00.000Z'),
      };

      expect(areEffectiveDateIntervalsOverlapping(a, b)).toBe(false);
    });
  });
});

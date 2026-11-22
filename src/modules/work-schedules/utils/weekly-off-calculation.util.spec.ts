import {
  WeeklyOffCalculationUtil,
  WeeklyOffRuleItem,
} from './weekly-off-calculation.util';
import { DayOfWeek, WeekOccurrence } from '../constants/weekly-off.constant';

describe('WeeklyOffCalculationUtil', () => {
  describe('calculateDayOccurrence', () => {
    it('should correctly calculate weekday and occurrence in the month', () => {
      // October 2026 calendar:
      // Oct 1: Thursday (1st)
      // Oct 3: Saturday (1st)
      // Oct 4: Sunday (1st)
      // Oct 10: Saturday (2nd)
      // Oct 11: Sunday (2nd)
      // Oct 17: Saturday (3rd)
      // Oct 18: Sunday (3rd)
      // Oct 24: Saturday (4th)
      // Oct 25: Sunday (4th)
      // Oct 31: Saturday (5th)
      expect(
        WeeklyOffCalculationUtil.calculateDayOccurrence('2026-10-01'),
      ).toEqual({
        dayOfWeek: DayOfWeek.THURSDAY,
        occurrence: WeekOccurrence.FIRST,
      });

      expect(
        WeeklyOffCalculationUtil.calculateDayOccurrence('2026-10-03'),
      ).toEqual({
        dayOfWeek: DayOfWeek.SATURDAY,
        occurrence: WeekOccurrence.FIRST,
      });

      expect(
        WeeklyOffCalculationUtil.calculateDayOccurrence('2026-10-10'),
      ).toEqual({
        dayOfWeek: DayOfWeek.SATURDAY,
        occurrence: WeekOccurrence.SECOND,
      });

      expect(
        WeeklyOffCalculationUtil.calculateDayOccurrence('2026-10-17'),
      ).toEqual({
        dayOfWeek: DayOfWeek.SATURDAY,
        occurrence: WeekOccurrence.THIRD,
      });

      expect(
        WeeklyOffCalculationUtil.calculateDayOccurrence('2026-10-24'),
      ).toEqual({
        dayOfWeek: DayOfWeek.SATURDAY,
        occurrence: WeekOccurrence.FOURTH,
      });

      expect(
        WeeklyOffCalculationUtil.calculateDayOccurrence('2026-10-31'),
      ).toEqual({
        dayOfWeek: DayOfWeek.SATURDAY,
        occurrence: WeekOccurrence.FIFTH,
      });

      expect(
        WeeklyOffCalculationUtil.calculateDayOccurrence('2026-10-04'),
      ).toEqual({
        dayOfWeek: DayOfWeek.SUNDAY,
        occurrence: WeekOccurrence.FIRST,
      });

      expect(
        WeeklyOffCalculationUtil.calculateDayOccurrence('2026-10-25'),
      ).toEqual({
        dayOfWeek: DayOfWeek.SUNDAY,
        occurrence: WeekOccurrence.FOURTH,
      });
    });
  });

  describe('isDateWeeklyOff', () => {
    it('should return false if rules array is empty or null', () => {
      expect(WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-04', [])).toBe(
        false,
      );
    });

    it('should handle standard Every Sunday rule', () => {
      const rules: WeeklyOffRuleItem[] = [
        {
          dayOfWeek: DayOfWeek.SUNDAY,
          occurrences: [1, 2, 3, 4, 5],
        },
      ];

      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-04', rules),
      ).toBe(true);
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-11', rules),
      ).toBe(true);
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-18', rules),
      ).toBe(true);
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-25', rules),
      ).toBe(true);
      // Monday should not be weekly off
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-05', rules),
      ).toBe(false);
      // Saturday should not be weekly off
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-10', rules),
      ).toBe(false);
    });

    it('should handle 2nd and 4th Saturday rule', () => {
      const rules: WeeklyOffRuleItem[] = [
        {
          dayOfWeek: DayOfWeek.SATURDAY,
          occurrences: [2, 4],
        },
      ];

      // 1st Saturday -> false
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-03', rules),
      ).toBe(false);
      // 2nd Saturday -> true
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-10', rules),
      ).toBe(true);
      // 3rd Saturday -> false
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-17', rules),
      ).toBe(false);
      // 4th Saturday -> true
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-24', rules),
      ).toBe(true);
      // 5th Saturday -> false
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-31', rules),
      ).toBe(false);
    });

    it('should handle 1st and 3rd Saturday rule', () => {
      const rules: WeeklyOffRuleItem[] = [
        {
          dayOfWeek: DayOfWeek.SATURDAY,
          occurrences: [1, 3],
        },
      ];

      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-03', rules),
      ).toBe(true);
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-10', rules),
      ).toBe(false);
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-17', rules),
      ).toBe(true);
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-24', rules),
      ).toBe(false);
    });

    it('should handle custom combination: Every Sunday + 2nd & 4th Saturday', () => {
      const rules: WeeklyOffRuleItem[] = [
        { dayOfWeek: DayOfWeek.SUNDAY, occurrences: [1, 2, 3, 4, 5] },
        { dayOfWeek: DayOfWeek.SATURDAY, occurrences: [2, 4] },
      ];

      // Sundays
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-04', rules),
      ).toBe(true);
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-11', rules),
      ).toBe(true);
      // Saturdays
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-03', rules),
      ).toBe(false); // 1st Sat
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-10', rules),
      ).toBe(true); // 2nd Sat
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-17', rules),
      ).toBe(false); // 3rd Sat
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-24', rules),
      ).toBe(true); // 4th Sat
      // Weekday
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-07', rules),
      ).toBe(false);
    });

    it('should treat empty or omitted occurrences as all occurrences of that day', () => {
      const rules: WeeklyOffRuleItem[] = [
        { dayOfWeek: DayOfWeek.SUNDAY }, // occurrences omitted
      ];

      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-04', rules),
      ).toBe(true);
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-11', rules),
      ).toBe(true);
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-18', rules),
      ).toBe(true);
      expect(
        WeeklyOffCalculationUtil.isDateWeeklyOff('2026-10-25', rules),
      ).toBe(true);
    });
  });

  describe('isDateRangeOverlapping', () => {
    it('should detect overlap when both ranges are ongoing', () => {
      expect(
        WeeklyOffCalculationUtil.isDateRangeOverlapping(
          { effectiveFrom: '2026-01-01', effectiveTo: null },
          { effectiveFrom: '2026-06-01', effectiveTo: null },
        ),
      ).toBe(true);
    });

    it('should detect overlap when one is ongoing and other starts during or after', () => {
      expect(
        WeeklyOffCalculationUtil.isDateRangeOverlapping(
          { effectiveFrom: '2026-01-01', effectiveTo: null },
          { effectiveFrom: '2026-06-01', effectiveTo: '2026-12-31' },
        ),
      ).toBe(true);
    });

    it('should not detect overlap when bounded range ends before ongoing range starts', () => {
      expect(
        WeeklyOffCalculationUtil.isDateRangeOverlapping(
          { effectiveFrom: '2026-07-01', effectiveTo: null },
          { effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' },
        ),
      ).toBe(false);
    });

    it('should detect overlap when bounded ranges intersect', () => {
      expect(
        WeeklyOffCalculationUtil.isDateRangeOverlapping(
          { effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' },
          { effectiveFrom: '2026-04-01', effectiveTo: '2026-09-30' },
        ),
      ).toBe(true);
    });

    it('should not detect overlap when bounded ranges are disjoint', () => {
      expect(
        WeeklyOffCalculationUtil.isDateRangeOverlapping(
          { effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' },
          { effectiveFrom: '2026-07-01', effectiveTo: '2026-12-31' },
        ),
      ).toBe(false);
    });
  });
});

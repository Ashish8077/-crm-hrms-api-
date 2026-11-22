import {
  LeaveCalculationUtil,
  LeaveCalculationPolicy,
} from './leave-calculation.util';
import { AppError } from '../../../common/errors/app-error';

describe('LeaveCalculationUtil', () => {
  const defaultPolicy = {
    deductWeekends: false,
    deductHolidays: false,
    allowHalfDay: true,
    maxConsecutiveDays: 14,
  };

  describe('enumerateDateStrings', () => {
    it('should generate continuous dates between start and end', () => {
      const dates = LeaveCalculationUtil.enumerateDateStrings(
        '2026-10-20',
        '2026-10-23',
      );
      expect(dates).toEqual([
        '2026-10-20',
        '2026-10-21',
        '2026-10-22',
        '2026-10-23',
      ]);
    });

    it('should return single date array when start equals end', () => {
      const dates = LeaveCalculationUtil.enumerateDateStrings(
        '2026-10-20',
        '2026-10-20',
      );
      expect(dates).toEqual(['2026-10-20']);
    });

    it('should correctly cross month and year boundaries', () => {
      const dates = LeaveCalculationUtil.enumerateDateStrings(
        '2026-12-30',
        '2027-01-02',
      );
      expect(dates).toEqual([
        '2026-12-30',
        '2026-12-31',
        '2027-01-01',
        '2027-01-02',
      ]);
    });
  });

  describe('isWeekend', () => {
    it('should correctly identify Sundays by default', () => {
      // 2026-10-25 is Sunday
      expect(LeaveCalculationUtil.isWeekend('2026-10-25')).toBe(true);
      // 2026-10-26 is Monday
      expect(LeaveCalculationUtil.isWeekend('2026-10-26')).toBe(false);
    });

    it('should support custom weekend configuration (e.g. Sat + Sun)', () => {
      // 2026-10-24 is Saturday, 2026-10-25 is Sunday
      expect(LeaveCalculationUtil.isWeekend('2026-10-24', [0, 6])).toBe(true);
      expect(LeaveCalculationUtil.isWeekend('2026-10-25', [0, 6])).toBe(true);
      expect(LeaveCalculationUtil.isWeekend('2026-10-26', [0, 6])).toBe(false);
    });
  });

  describe('validateDateRange', () => {
    it('should throw AppError on invalid date format', () => {
      expect(() =>
        LeaveCalculationUtil.validateDateRange('2026/10/20', '2026-10-22'),
      ).toThrow(AppError);
    });

    it('should throw AppError if startDate is after endDate', () => {
      expect(() =>
        LeaveCalculationUtil.validateDateRange('2026-10-25', '2026-10-20'),
      ).toThrow(AppError);
    });

    it('should throw AppError if isHalfDay is true on multi-day range', () => {
      expect(() =>
        LeaveCalculationUtil.validateDateRange(
          '2026-10-20',
          '2026-10-21',
          true,
        ),
      ).toThrow('Half-day leave must start and end on the exact same date');
    });

    it('should pass for valid same-day half-day', () => {
      expect(() =>
        LeaveCalculationUtil.validateDateRange(
          '2026-10-20',
          '2026-10-20',
          true,
        ),
      ).not.toThrow();
    });
  });

  describe('calculateLeaveDuration', () => {
    it('should calculate full day standard working days excluding Sundays', () => {
      // 2026-10-23 (Fri), 2026-10-24 (Sat), 2026-10-25 (Sun), 2026-10-26 (Mon) = 4 calendar days
      // Sunday is excluded -> 3 deductible working days
      const result = LeaveCalculationUtil.calculateLeaveDuration(
        '2026-10-23',
        '2026-10-26',
        false,
        defaultPolicy,
      );

      expect(result.totalDays).toBe(3);
      expect(result.applicableDates).toEqual([
        '2026-10-23',
        '2026-10-24',
        '2026-10-26',
      ]);
      expect(result.excludedWeekendDates).toEqual(['2026-10-25']);
      expect(result.yearBreakdown).toEqual([{ year: 2026, days: 3 }]);
    });

    it('should deduct weekends and holidays when sandwich rule flags are enabled', () => {
      const holidays = new Set(['2026-10-24']);
      const sandwichPolicy = {
        ...defaultPolicy,
        deductWeekends: true,
        deductHolidays: true,
      };

      const result = LeaveCalculationUtil.calculateLeaveDuration(
        '2026-10-23',
        '2026-10-26',
        false,
        sandwichPolicy,
        holidays,
      );

      expect(result.totalDays).toBe(4);
      expect(result.excludedWeekendDates).toHaveLength(0);
      expect(result.excludedHolidayDates).toHaveLength(0);
    });

    it('should support dynamic Set of weekly off dates (e.g. 2nd & 4th Saturday + Sunday)', () => {
      // 2026-10-09 (Fri) to 2026-10-12 (Mon) = 4 calendar days
      // 2026-10-10 is 2nd Saturday (off), 2026-10-11 is Sunday (off)
      const weeklyOffDates = new Set(['2026-10-10', '2026-10-11']);
      const result = LeaveCalculationUtil.calculateLeaveDuration(
        '2026-10-09',
        '2026-10-12',
        false,
        defaultPolicy,
        new Set<string>(),
        weeklyOffDates,
      );

      // Only Friday (Oct 9) and Monday (Oct 12) should be deducted = 2 days
      expect(result.totalDays).toBe(2);
      expect(result.excludedWeekendDates).toEqual(['2026-10-10', '2026-10-11']);
    });

    it('should support predicate function for dynamic weekly off evaluation', () => {
      const isOffFn = (dStr: string) =>
        dStr === '2026-10-10' || dStr === '2026-10-11';
      const result = LeaveCalculationUtil.calculateLeaveDuration(
        '2026-10-09',
        '2026-10-12',
        false,
        defaultPolicy,
        new Set<string>(),
        isOffFn,
      );

      expect(result.totalDays).toBe(2);
      expect(result.excludedWeekendDates).toEqual(['2026-10-10', '2026-10-11']);
    });

    it('should correctly calculate half-day leave as 0.5 days', () => {
      const result = LeaveCalculationUtil.calculateLeaveDuration(
        '2026-10-21',
        '2026-10-21',
        true,
        defaultPolicy,
      );

      expect(result.totalDays).toBe(0.5);
      expect(result.yearBreakdown).toEqual([{ year: 2026, days: 0.5 }]);
    });

    describe('All 4 combinations of deductWeekends and deductHolidays (single & multi-year)', () => {
      // Range: 2026-12-30 (Wed) to 2027-01-04 (Mon) -> 6 calendar days
      // 2026-12-30: Wed (Working)
      // 2026-12-31: Thu (Working)
      // 2027-01-01: Fri (Applicable Holiday)
      // 2027-01-02: Sat (Configured Weekly Off)
      // 2027-01-03: Sun (Configured Weekly Off)
      // 2027-01-04: Mon (Working)
      const multiYearHolidays = new Set(['2027-01-01']);
      const configuredWeeklyOffs = new Set(['2027-01-02', '2027-01-03']);

      it('Combination 1 (false, false): should exclude weekly offs and holidays across both years', () => {
        const policy: LeaveCalculationPolicy = {
          deductWeekends: false,
          deductHolidays: false,
          allowHalfDay: true,
          maxConsecutiveDays: 30,
        };

        const result = LeaveCalculationUtil.calculateLeaveDuration(
          '2026-12-30',
          '2027-01-04',
          false,
          policy,
          multiYearHolidays,
          configuredWeeklyOffs,
        );

        // 2026: Dec 30, 31 = 2 days
        // 2027: Jan 01 (Hldy excluded), Jan 02 & 03 (Wknd excluded), Jan 04 = 1 day
        expect(result.totalDays).toBe(3);
        expect(result.yearBreakdown).toEqual([
          { year: 2026, days: 2 },
          { year: 2027, days: 1 },
        ]);
        expect(result.applicableDates).toEqual([
          '2026-12-30',
          '2026-12-31',
          '2027-01-04',
        ]);
        expect(result.excludedWeekendDates).toEqual([
          '2027-01-02',
          '2027-01-03',
        ]);
        expect(result.excludedHolidayDates).toEqual(['2027-01-01']);
      });

      it('Combination 2 (true, false): should deduct weekly offs but exclude holidays across both years', () => {
        const policy: LeaveCalculationPolicy = {
          deductWeekends: true,
          deductHolidays: false,
          allowHalfDay: true,
          maxConsecutiveDays: 30,
        };

        const result = LeaveCalculationUtil.calculateLeaveDuration(
          '2026-12-30',
          '2027-01-04',
          false,
          policy,
          multiYearHolidays,
          configuredWeeklyOffs,
        );

        // 2026: Dec 30, 31 = 2 days
        // 2027: Jan 01 (Hldy excluded), Jan 02 (Wknd deducted), Jan 03 (Wknd deducted), Jan 04 = 3 days
        expect(result.totalDays).toBe(5);
        expect(result.yearBreakdown).toEqual([
          { year: 2026, days: 2 },
          { year: 2027, days: 3 },
        ]);
        expect(result.applicableDates).toEqual([
          '2026-12-30',
          '2026-12-31',
          '2027-01-02',
          '2027-01-03',
          '2027-01-04',
        ]);
        expect(result.excludedWeekendDates).toHaveLength(0);
        expect(result.excludedHolidayDates).toEqual(['2027-01-01']);
      });

      it('Combination 3 (false, true): should exclude weekly offs but deduct holidays across both years', () => {
        const policy: LeaveCalculationPolicy = {
          deductWeekends: false,
          deductHolidays: true,
          allowHalfDay: true,
          maxConsecutiveDays: 30,
        };

        const result = LeaveCalculationUtil.calculateLeaveDuration(
          '2026-12-30',
          '2027-01-04',
          false,
          policy,
          multiYearHolidays,
          configuredWeeklyOffs,
        );

        // 2026: Dec 30, 31 = 2 days
        // 2027: Jan 01 (Hldy deducted), Jan 02 & 03 (Wknd excluded), Jan 04 = 2 days
        expect(result.totalDays).toBe(4);
        expect(result.yearBreakdown).toEqual([
          { year: 2026, days: 2 },
          { year: 2027, days: 2 },
        ]);
        expect(result.applicableDates).toEqual([
          '2026-12-30',
          '2026-12-31',
          '2027-01-01',
          '2027-01-04',
        ]);
        expect(result.excludedWeekendDates).toEqual([
          '2027-01-02',
          '2027-01-03',
        ]);
        expect(result.excludedHolidayDates).toHaveLength(0);
      });

      it('Combination 4 (true, true): should deduct both weekly offs and holidays across both years', () => {
        const policy: LeaveCalculationPolicy = {
          deductWeekends: true,
          deductHolidays: true,
          allowHalfDay: true,
          maxConsecutiveDays: 30,
        };

        const result = LeaveCalculationUtil.calculateLeaveDuration(
          '2026-12-30',
          '2027-01-04',
          false,
          policy,
          multiYearHolidays,
          configuredWeeklyOffs,
        );

        // All 6 calendar days deducted (2 in 2026, 4 in 2027)
        expect(result.totalDays).toBe(6);
        expect(result.yearBreakdown).toEqual([
          { year: 2026, days: 2 },
          { year: 2027, days: 4 },
        ]);
        expect(result.applicableDates).toEqual([
          '2026-12-30',
          '2026-12-31',
          '2027-01-01',
          '2027-01-02',
          '2027-01-03',
          '2027-01-04',
        ]);
        expect(result.excludedWeekendDates).toHaveLength(0);
        expect(result.excludedHolidayDates).toHaveLength(0);
      });

      it('should handle non-standard configured weekly offs (e.g. Wednesday weekly off) without hardcoding', () => {
        // Wednesday Dec 30 is the configured weekly off for this employee's schedule
        const wednesdayOff = new Set(['2026-12-30']);
        const result = LeaveCalculationUtil.calculateLeaveDuration(
          '2026-12-29',
          '2026-12-31',
          false,
          { deductWeekends: false, deductHolidays: false, allowHalfDay: true },
          new Set<string>(),
          wednesdayOff,
        );

        // Tue Dec 29 (included), Wed Dec 30 (excluded weekly off), Thu Dec 31 (included) = 2 days
        expect(result.totalDays).toBe(2);
        expect(result.excludedWeekendDates).toEqual(['2026-12-30']);
        expect(result.applicableDates).toEqual(['2026-12-29', '2026-12-31']);
      });

      describe('Overlapping holidays and weekly offs on the exact same date (without double-counting)', () => {
        // Range: Fri 2026-10-23 to Mon 2026-10-26 (4 calendar days)
        // Sat 2026-10-24: Weekly off
        // Sun 2026-10-25: BOTH Weekly Off AND Public Holiday (coinciding)
        const weeklyOffsWithOverlap = new Set(['2026-10-24', '2026-10-25']);
        const holidayOnSunday = new Set(['2026-10-25']);

        it('Overlap Case 1 (false, false): should exclude overlapping Sunday without double subtraction', () => {
          const result = LeaveCalculationUtil.calculateLeaveDuration(
            '2026-10-23',
            '2026-10-26',
            false,
            {
              deductWeekends: false,
              deductHolidays: false,
              allowHalfDay: true,
            },
            holidayOnSunday,
            weeklyOffsWithOverlap,
          );

          // Only Fri (23) and Mon (26) deducted = 2 days
          expect(result.totalDays).toBe(2);
          expect(result.applicableDates).toEqual(['2026-10-23', '2026-10-26']);
          expect(result.excludedWeekendDates).toEqual([
            '2026-10-24',
            '2026-10-25',
          ]);
          expect(result.excludedHolidayDates).toEqual(['2026-10-25']);
        });

        it('Overlap Case 2 (true, false): should deduct Saturday but exclude overlapping Sunday because holidays are not deducted', () => {
          const result = LeaveCalculationUtil.calculateLeaveDuration(
            '2026-10-23',
            '2026-10-26',
            false,
            { deductWeekends: true, deductHolidays: false, allowHalfDay: true },
            holidayOnSunday,
            weeklyOffsWithOverlap,
          );

          // Fri (23), Sat (24 - wknd deducted), Mon (26) = 3 days. Sun (25) is excluded as holiday.
          expect(result.totalDays).toBe(3);
          expect(result.applicableDates).toEqual([
            '2026-10-23',
            '2026-10-24',
            '2026-10-26',
          ]);
          expect(result.excludedWeekendDates).toHaveLength(0);
          expect(result.excludedHolidayDates).toEqual(['2026-10-25']);
        });

        it('Overlap Case 3 (false, true): should exclude overlapping Sunday because weekly offs are not deducted', () => {
          const result = LeaveCalculationUtil.calculateLeaveDuration(
            '2026-10-23',
            '2026-10-26',
            false,
            { deductWeekends: false, deductHolidays: true, allowHalfDay: true },
            holidayOnSunday,
            weeklyOffsWithOverlap,
          );

          // Fri (23) and Mon (26) = 2 days. Sat (24) and Sun (25) are excluded as weekly offs.
          expect(result.totalDays).toBe(2);
          expect(result.applicableDates).toEqual(['2026-10-23', '2026-10-26']);
          expect(result.excludedWeekendDates).toEqual([
            '2026-10-24',
            '2026-10-25',
          ]);
          expect(result.excludedHolidayDates).toHaveLength(0);
        });

        it('Overlap Case 4 (true, true): should deduct overlapping Sunday exactly once without double counting', () => {
          const result = LeaveCalculationUtil.calculateLeaveDuration(
            '2026-10-23',
            '2026-10-26',
            false,
            { deductWeekends: true, deductHolidays: true, allowHalfDay: true },
            holidayOnSunday,
            weeklyOffsWithOverlap,
          );

          // All 4 calendar days deducted exactly once (Fri, Sat, Sun, Mon) = 4 days
          expect(result.totalDays).toBe(4);
          expect(result.applicableDates).toEqual([
            '2026-10-23',
            '2026-10-24',
            '2026-10-25',
            '2026-10-26',
          ]);
          expect(result.excludedWeekendDates).toHaveLength(0);
          expect(result.excludedHolidayDates).toHaveLength(0);
        });
      });

      describe('Half-day leaves across all 4 combinations', () => {
        // Date: Sun 2026-10-25 (Weekly off & Holiday)
        const sundayHoliday = new Set(['2026-10-25']);
        const sundayWeeklyOff = new Set(['2026-10-25']);

        it('should reject half-day on excluded overlapping day under (false, false)', () => {
          expect(() =>
            LeaveCalculationUtil.calculateLeaveDuration(
              '2026-10-25',
              '2026-10-25',
              true,
              {
                deductWeekends: false,
                deductHolidays: false,
                allowHalfDay: true,
              },
              sundayHoliday,
              sundayWeeklyOff,
            ),
          ).toThrow(
            'Selected date range contains only weekends or holidays with zero deductible working days',
          );
        });

        it('should allow half-day on overlapping day under (true, true) as exactly 0.5 days', () => {
          const result = LeaveCalculationUtil.calculateLeaveDuration(
            '2026-10-25',
            '2026-10-25',
            true,
            { deductWeekends: true, deductHolidays: true, allowHalfDay: true },
            sundayHoliday,
            sundayWeeklyOff,
          );

          expect(result.totalDays).toBe(0.5);
          expect(result.yearBreakdown).toEqual([{ year: 2026, days: 0.5 }]);
        });
      });
    });

    it('should split leave across two calendar years accurately (User Decision #3)', () => {
      // 2026-12-28 (Mon) to 2027-01-04 (Mon)
      // 2026-12-28, 29, 30, 31 = 4 days in 2026
      // 2027-01-01 (Fri - holiday), 2027-01-02 (Sat), 2027-01-03 (Sun - weekend), 2027-01-04 (Mon)
      const holidays = new Set(['2027-01-01']); // New Year's Day
      const result = LeaveCalculationUtil.calculateLeaveDuration(
        '2026-12-28',
        '2027-01-04',
        false,
        { ...defaultPolicy, maxConsecutiveDays: 30 },
        holidays,
        [0], // Sunday weekend
      );

      // In 2026: Dec 28, 29, 30, 31 = 4 days
      // In 2027: Jan 01 is Holiday (excluded), Jan 02 is Sat (included), Jan 03 is Sun (excluded), Jan 04 is Mon (included) = 2 days
      expect(result.totalDays).toBe(6);
      expect(result.yearBreakdown).toEqual([
        { year: 2026, days: 4 },
        { year: 2027, days: 2 },
      ]);
    });

    it('should throw AppError if date range contains only excluded non-working days', () => {
      // 2026-10-25 is Sunday
      expect(() =>
        LeaveCalculationUtil.calculateLeaveDuration(
          '2026-10-25',
          '2026-10-25',
          false,
          defaultPolicy,
        ),
      ).toThrow(
        'Selected date range contains only weekends or holidays with zero deductible working days',
      );
    });

    it('should reject requests exceeding maxConsecutiveDays', () => {
      expect(() =>
        LeaveCalculationUtil.calculateLeaveDuration(
          '2026-10-01',
          '2026-10-15',
          false,
          { ...defaultPolicy, maxConsecutiveDays: 5 },
        ),
      ).toThrow('exceeds maximum consecutive limit of 5 days');
    });

    describe('maxConsecutiveDays interaction with deductWeekends and deductHolidays', () => {
      // Span: Fri 2026-10-09 to Mon 2026-10-12 (4 calendar days)
      // Sat 2026-10-10 & Sun 2026-10-11 are configured weekly offs
      const weeklyOffs = new Set(['2026-10-10', '2026-10-11']);

      it('should allow Friday-Monday leave when maxConsecutiveDays: 3 and deductWeekends: false (2 days counted)', () => {
        const result = LeaveCalculationUtil.calculateLeaveDuration(
          '2026-10-09',
          '2026-10-12',
          false,
          {
            deductWeekends: false,
            deductHolidays: false,
            allowHalfDay: true,
            maxConsecutiveDays: 3,
          },
          new Set<string>(),
          weeklyOffs,
        );

        expect(result.totalDays).toBe(2);
      });

      it('should reject Friday-Monday leave when maxConsecutiveDays: 3 and deductWeekends: true (4 days counted > 3)', () => {
        expect(() =>
          LeaveCalculationUtil.calculateLeaveDuration(
            '2026-10-09',
            '2026-10-12',
            false,
            {
              deductWeekends: true,
              deductHolidays: false,
              allowHalfDay: true,
              maxConsecutiveDays: 3,
            },
            new Set<string>(),
            weeklyOffs,
          ),
        ).toThrow(
          'Leave duration (4 days) exceeds maximum consecutive limit of 3 days',
        );
      });

      it('should count holiday toward maxConsecutiveDays when deductHolidays: true', () => {
        // Fri to Tue (5 calendar days). Sat & Sun are weekly offs. Tue 2026-10-13 is a Holiday.
        const holidays = new Set(['2026-10-13']);

        // When deductHolidays is false: Fri & Mon = 2 days (allowed if max: 2)
        const allowedResult = LeaveCalculationUtil.calculateLeaveDuration(
          '2026-10-09',
          '2026-10-13',
          false,
          {
            deductWeekends: false,
            deductHolidays: false,
            allowHalfDay: true,
            maxConsecutiveDays: 2,
          },
          holidays,
          weeklyOffs,
        );
        expect(allowedResult.totalDays).toBe(2);

        // When deductHolidays is true: Fri, Mon & Tue = 3 days (rejected if max: 2)
        expect(() =>
          LeaveCalculationUtil.calculateLeaveDuration(
            '2026-10-09',
            '2026-10-13',
            false,
            {
              deductWeekends: false,
              deductHolidays: true,
              allowHalfDay: true,
              maxConsecutiveDays: 2,
            },
            holidays,
            weeklyOffs,
          ),
        ).toThrow(
          'Leave duration (3 days) exceeds maximum consecutive limit of 2 days',
        );
      });
    });
  });
});

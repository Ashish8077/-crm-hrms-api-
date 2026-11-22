import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { HttpStatus } from '@nestjs/common';
import { YearSplit } from '../schemas/leave-request.schema';

export interface LeaveCalculationPolicy {
  deductWeekends: boolean;
  deductHolidays: boolean;
  allowHalfDay: boolean;
  maxConsecutiveDays?: number | null;
}

export interface LeaveDurationResult {
  totalDays: number;
  applicableDates: string[];
  excludedWeekendDates: string[];
  excludedHolidayDates: string[];
  yearBreakdown: YearSplit[];
}

export class LeaveCalculationUtil {
  /**
   * Generates an array of canonical YYYY-MM-DD date strings between startDate and endDate (inclusive).
   * Uses UTC calendar arithmetic to prevent timezone or DST drift.
   */
  static enumerateDateStrings(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = endDate.split('-').map(Number);

    const current = new Date(Date.UTC(startYear, startMonth - 1, startDay));
    const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));

    while (current <= end) {
      const year = current.getUTCFullYear();
      const month = String(current.getUTCMonth() + 1).padStart(2, '0');
      const day = String(current.getUTCDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
  }

  /**
   * Determines if a given YYYY-MM-DD string falls on a configured weekend.
   * Default: Sunday (0).
   */
  static isWeekend(
    dateString: string,
    weekendDays: number[] = [0], // Default Sunday
  ): boolean {
    const [year, month, day] = dateString.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return weekendDays.includes(dayOfWeek);
  }

  /**
   * Validates date range chronology and half-day constraints.
   */
  static validateDateRange(
    startDate: string,
    endDate: string,
    isHalfDay: boolean = false,
  ): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'startDate must be in valid YYYY-MM-DD format',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'endDate must be in valid YYYY-MM-DD format',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (startDate > endDate) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'startDate cannot be after endDate',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (isHalfDay && startDate !== endDate) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Half-day leave must start and end on the exact same date',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Centralized leave duration and year-split calculation engine.
   * Considers:
   *  - Total calendar dates span
   *  - Half-day selection (0.5)
   *  - Weekly off exclusions (unless deductWeekends is true)
   *  - Public/Branch holiday exclusions (unless deductHolidays is true)
   *  - Calendar year crossover breakdown (User Decision #3)
   */
  static calculateLeaveDuration(
    startDate: string,
    endDate: string,
    isHalfDay: boolean,
    policy: LeaveCalculationPolicy,
    holidayDates: Set<string> = new Set<string>(),
    weekendDaysOrRule:
      number[] | Set<string> | ((dateString: string) => boolean) = [0],
  ): LeaveDurationResult {
    this.validateDateRange(startDate, endDate, isHalfDay);

    if (isHalfDay && !policy.allowHalfDay) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Half-day leave is not permitted for this leave type',
        HttpStatus.BAD_REQUEST,
      );
    }

    const allDates = this.enumerateDateStrings(startDate, endDate);
    const applicableDates: string[] = [];
    const excludedWeekendDates: string[] = [];
    const excludedHolidayDates: string[] = [];
    const yearDaysMap = new Map<number, number>();

    for (const dateStr of allDates) {
      let isWknd = false;
      if (weekendDaysOrRule instanceof Set) {
        isWknd = weekendDaysOrRule.has(dateStr);
      } else if (typeof weekendDaysOrRule === 'function') {
        isWknd = weekendDaysOrRule(dateStr);
      } else if (Array.isArray(weekendDaysOrRule)) {
        isWknd = this.isWeekend(dateStr, weekendDaysOrRule);
      }

      const isHldy = holidayDates.has(dateStr);

      const isExcludedWeekend = isWknd && !policy.deductWeekends;
      const isExcludedHoliday = isHldy && !policy.deductHolidays;

      if (isExcludedWeekend) {
        excludedWeekendDates.push(dateStr);
      }
      if (isExcludedHoliday) {
        excludedHolidayDates.push(dateStr);
      }

      if (isExcludedWeekend || isExcludedHoliday) {
        continue;
      }

      applicableDates.push(dateStr);

      const year = Number(dateStr.slice(0, 4));
      const dayValue = isHalfDay ? 0.5 : 1;
      yearDaysMap.set(year, (yearDaysMap.get(year) || 0) + dayValue);
    }

    const totalDays = isHalfDay
      ? applicableDates.length > 0
        ? 0.5
        : 0
      : applicableDates.length;

    if (totalDays === 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Selected date range contains only weekends or holidays with zero deductible working days',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      policy.maxConsecutiveDays &&
      policy.maxConsecutiveDays > 0 &&
      totalDays > policy.maxConsecutiveDays
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Leave duration (${totalDays} days) exceeds maximum consecutive limit of ${policy.maxConsecutiveDays} days`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Convert yearDaysMap into YearSplit[] (User Decision #3)
    const yearBreakdown: YearSplit[] = Array.from(yearDaysMap.entries()).map(
      ([year, days]) => ({
        year,
        days,
      }),
    );

    return {
      totalDays,
      applicableDates,
      excludedWeekendDates,
      excludedHolidayDates,
      yearBreakdown,
    };
  }
}

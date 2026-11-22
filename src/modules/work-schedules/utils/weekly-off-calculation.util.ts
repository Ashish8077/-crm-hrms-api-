export interface WeeklyOffRuleItem {
  dayOfWeek: number;
  occurrences?: readonly number[] | number[];
}

export class WeeklyOffCalculationUtil {
  /**
   * Calculates the day of the week (0=Sunday, 6=Saturday) and the 1-based nth occurrence
   * of that weekday within the calendar month (1=1st, 2=2nd, 3=3rd, 4=4th, 5=5th).
   */
  static calculateDayOccurrence(dateString: string): {
    dayOfWeek: number;
    occurrence: number;
  } {
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = date.getUTCDay();
    const occurrence = Math.ceil(day / 7);
    return { dayOfWeek, occurrence };
  }

  /**
   * Determines whether the given date (YYYY-MM-DD) is a weekly off according to the provided rules.
   */
  static isDateWeeklyOff(
    dateString: string,
    rules: readonly WeeklyOffRuleItem[],
  ): boolean {
    if (!rules || rules.length === 0) {
      return false;
    }

    const { dayOfWeek, occurrence } = this.calculateDayOccurrence(dateString);
    const matchingRule = rules.find((r) => r.dayOfWeek === dayOfWeek);

    if (!matchingRule) {
      return false;
    }

    if (!matchingRule.occurrences || matchingRule.occurrences.length === 0) {
      return true;
    }

    return matchingRule.occurrences.includes(occurrence);
  }

  /**
   * Checks if two effective date ranges [effectiveFrom, effectiveTo] overlap.
   * effectiveTo: null or undefined denotes an ongoing / open-ended period.
   */
  static isDateRangeOverlapping(
    a: { effectiveFrom: string; effectiveTo?: string | null },
    b: { effectiveFrom: string; effectiveTo?: string | null },
  ): boolean {
    const aTo = a.effectiveTo ?? null;
    const bTo = b.effectiveTo ?? null;

    if (aTo === null && bTo === null) {
      return true;
    }
    if (aTo === null) {
      return bTo! >= a.effectiveFrom;
    }
    if (bTo === null) {
      return aTo >= b.effectiveFrom;
    }

    return a.effectiveFrom <= bTo && aTo >= b.effectiveFrom;
  }
}

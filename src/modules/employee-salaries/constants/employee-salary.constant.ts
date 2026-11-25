export enum EmployeeSalaryStatus {
  ACTIVE = 'ACTIVE',
  SUPERSEDED = 'SUPERSEDED',
}

export const EMPLOYEE_SALARY_SORTABLE_FIELDS = [
  'effectiveFrom',
  'createdAt',
] as const;

export type EmployeeSalarySortableField =
  (typeof EMPLOYEE_SALARY_SORTABLE_FIELDS)[number];

/**
 * Normalizes an effective date to midnight UTC (00:00:00.000Z).
 * Accepts YYYY-MM-DD string, full ISO date string, or Date instance.
 * Avoids any timezone shift or local hour offset.
 */
export function normalizeEffectiveDate(dateInput: string | Date): Date {
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    // Case 1: Simple YYYY-MM-DD
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const day = parseInt(match[3], 10);

      const d = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      if (
        d.getUTCFullYear() !== year ||
        d.getUTCMonth() !== month - 1 ||
        d.getUTCDate() !== day
      ) {
        throw new Error(`Invalid calendar date: ${trimmed}`);
      }
      return d;
    }

    // Case 2: Full ISO string or date parseable
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      throw new Error(`Invalid date format: ${trimmed}`);
    }
    return new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
  }

  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) {
      throw new Error('Invalid Date object provided');
    }
    return new Date(
      Date.UTC(
        dateInput.getUTCFullYear(),
        dateInput.getUTCMonth(),
        dateInput.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
  }

  throw new Error('Date input must be a string or Date instance');
}

/**
 * Checks whether two half-open date intervals [effectiveFrom, effectiveTo) overlap.
 * - effectiveFrom is inclusive
 * - effectiveTo is exclusive (null denotes ongoing / open-ended)
 *
 * Interval A and Interval B overlap if and only if:
 * a.effectiveFrom < (b.effectiveTo ?? Infinity) && b.effectiveFrom < (a.effectiveTo ?? Infinity)
 */
export function areEffectiveDateIntervalsOverlapping(
  a: { effectiveFrom: Date; effectiveTo?: Date | null },
  b: { effectiveFrom: Date; effectiveTo?: Date | null },
): boolean {
  const aStart = a.effectiveFrom.getTime();
  const aEnd = a.effectiveTo ? a.effectiveTo.getTime() : Infinity;

  const bStart = b.effectiveFrom.getTime();
  const bEnd = b.effectiveTo ? b.effectiveTo.getTime() : Infinity;

  return aStart < bEnd && bStart < aEnd;
}

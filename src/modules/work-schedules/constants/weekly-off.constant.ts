export enum DayOfWeek {
  SUNDAY = 0,
  MONDAY = 1,
  TUESDAY = 2,
  WEDNESDAY = 3,
  THURSDAY = 4,
  FRIDAY = 5,
  SATURDAY = 6,
}

export enum WeekOccurrence {
  FIRST = 1,
  SECOND = 2,
  THIRD = 3,
  FOURTH = 4,
  FIFTH = 5,
}

export const WEEKLY_OFF_CONSTANTS = {
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 100,
  DESCRIPTION_MAX_LENGTH: 500,
  VALID_DAYS_OF_WEEK: [
    DayOfWeek.SUNDAY,
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.FRIDAY,
    DayOfWeek.SATURDAY,
  ] as const,
  VALID_OCCURRENCES: [
    WeekOccurrence.FIRST,
    WeekOccurrence.SECOND,
    WeekOccurrence.THIRD,
    WeekOccurrence.FOURTH,
    WeekOccurrence.FIFTH,
  ] as const,
  DEFAULT_WEEKLY_OFF_DAYS: [
    {
      dayOfWeek: DayOfWeek.SUNDAY,
      occurrences: [
        WeekOccurrence.FIRST,
        WeekOccurrence.SECOND,
        WeekOccurrence.THIRD,
        WeekOccurrence.FOURTH,
        WeekOccurrence.FIFTH,
      ],
    },
  ],
} as const;

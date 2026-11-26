export enum PayrollPeriodStatus {
  DRAFT = 'DRAFT',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FINALIZED = 'FINALIZED',
}

export const PAYROLL_PERIOD_CONSTANTS = {
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 100,
  CODE_MIN_LENGTH: 3,
  CODE_MAX_LENGTH: 50,
  NOTES_MAX_LENGTH: 500,
  YEAR_MIN: 2000,
  YEAR_MAX: 2100,
  MONTH_MIN: 1,
  MONTH_MAX: 12,
} as const;

export const PAYROLL_PERIOD_SORTABLE_FIELDS = [
  'startDate',
  'endDate',
  'paymentDate',
  'year',
  'month',
  'status',
  'createdAt',
  'periodCode',
] as const;

export type PayrollPeriodSortableField =
  (typeof PAYROLL_PERIOD_SORTABLE_FIELDS)[number];

export const ALLOWED_STATUS_TRANSITIONS: Record<
  PayrollPeriodStatus,
  PayrollPeriodStatus[]
> = {
  [PayrollPeriodStatus.DRAFT]: [PayrollPeriodStatus.PROCESSING],
  [PayrollPeriodStatus.PROCESSING]: [
    PayrollPeriodStatus.COMPLETED,
    PayrollPeriodStatus.DRAFT, // rollback/cancel processing
  ],
  [PayrollPeriodStatus.COMPLETED]: [
    PayrollPeriodStatus.FINALIZED, // final approval and lock
    PayrollPeriodStatus.PROCESSING, // recalculation rollback
  ],
  [PayrollPeriodStatus.FINALIZED]: [], // terminal state: immutable
};

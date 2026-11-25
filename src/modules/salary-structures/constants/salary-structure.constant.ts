export enum SalaryStructureBasis {
  CTC = 'CTC',
  GROSS = 'GROSS',
}

export enum SalaryStructureFrequency {
  MONTHLY = 'MONTHLY',
  ANNUAL = 'ANNUAL',
}

export enum StructureComponentCalculationType {
  FIXED = 'FIXED',
  PERCENTAGE = 'PERCENTAGE',
  BALANCE = 'BALANCE',
}

export enum StructureComponentPercentageBasis {
  BASIC = 'BASIC',
  GROSS_SALARY = 'GROSS_SALARY',
}

export const SALARY_STRUCTURE_CONSTANTS = {
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 100,
  CODE_MIN_LENGTH: 2,
  CODE_MAX_LENGTH: 50,
  DESCRIPTION_MAX_LENGTH: 500,
} as const;

export const SALARY_STRUCTURE_SORTABLE_FIELDS = [
  'name',
  'code',
  'salaryBasis',
  'salaryFrequency',
  'salaryAmount',
  'isActive',
  'createdAt',
] as const;

export type SalaryStructureSortableField =
  (typeof SALARY_STRUCTURE_SORTABLE_FIELDS)[number];

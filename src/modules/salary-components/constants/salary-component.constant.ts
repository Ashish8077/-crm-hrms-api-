export enum SalaryComponentType {
  EARNING = 'EARNING',
  EMPLOYEE_DEDUCTION = 'EMPLOYEE_DEDUCTION',
  EMPLOYER_CONTRIBUTION = 'EMPLOYER_CONTRIBUTION',
  /** @deprecated Preserved for backward compatibility with pre-existing records */
  DEDUCTION = 'DEDUCTION',
}

/**
 * @deprecated Calculation configuration has been decoupled from SalaryComponent master
 * and belongs exclusively to SalaryStructure. Preserved for backward compatibility.
 */
export enum SalaryComponentCalculationType {
  FIXED = 'FIXED',
  PERCENTAGE = 'PERCENTAGE',
  BALANCE = 'BALANCE',
}

/**
 * @deprecated Calculation configuration has been decoupled from SalaryComponent master
 * and belongs exclusively to SalaryStructure. Preserved for backward compatibility.
 */
export enum SalaryComponentPercentageBasis {
  BASIC = 'BASIC',
  GROSS_SALARY = 'GROSS_SALARY',
  CTC = 'CTC',
  BASIC_AND_DA = 'BASIC_AND_DA',
}

export const SALARY_COMPONENT_CONSTANTS = {
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 100,
  CODE_MIN_LENGTH: 2,
  CODE_MAX_LENGTH: 50,
  DESCRIPTION_MAX_LENGTH: 500,
} as const;

export const GRATUITY_COMPONENT_CODE = 'GRATUITY';

export const SALARY_COMPONENT_SORTABLE_FIELDS = [
  'name',
  'code',
  'type',
  'calculationType',
  'isActive',
  'createdAt',
] as const;

export type SalaryComponentSortableField =
  (typeof SALARY_COMPONENT_SORTABLE_FIELDS)[number];

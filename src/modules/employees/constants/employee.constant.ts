export enum EmploymentType {
  FULL_TIME = 'full_time',
  PART_TIME = 'part_time',
  CONTRACT = 'contract',
  INTERN = 'intern',
}

export enum EmploymentStatus {
  ACTIVE = 'active',
  PROBATION = 'probation',
  NOTICE_PERIOD = 'notice_period',
  TERMINATED = 'terminated',
  RESIGNED = 'resigned',
}

export const ActiveEmploymentStatuses = [
  EmploymentStatus.ACTIVE,
  EmploymentStatus.PROBATION,
  EmploymentStatus.NOTICE_PERIOD,
];

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../../salary-structures/constants/salary-structure.constant';
import {
  NegativeNetPayPolicy,
  PayrollFrequency,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../../payroll-configuration/constants/payroll-configuration.constant';
import { EmploymentStatus } from '../../employees/constants/employee.constant';
import { PayrollRecordStatus } from '../constants/payroll-calculation.constant';

export class PayrollSnapshotComponentResponseDto {
  @ApiProperty({ example: '6745a1b2c3d4e5f67890abcd' })
  componentId!: string;

  @ApiProperty({ example: 'BASIC' })
  componentCode!: string;

  @ApiProperty({ example: 'Basic Salary' })
  componentName!: string;

  @ApiProperty({ enum: SalaryComponentType })
  classification!: SalaryComponentType;

  @ApiProperty({ enum: StructureComponentCalculationType })
  calculationMethod!: StructureComponentCalculationType;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 50 })
  percentage!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'BASIC' })
  percentageOf!: string | null;

  @ApiProperty({ type: String, example: '30000.00' })
  monthlyBaseAmount!: string;

  @ApiProperty({ type: String, example: '15000.00' })
  monthlyCalculatedAmount!: string;

  @ApiProperty({ example: true })
  prorationApplied!: boolean;

  @ApiProperty({ example: 15 })
  payableDays!: number;

  @ApiProperty({ example: 30 })
  calendarDays!: number;

  @ApiProperty({ type: String, example: '7500.00' })
  finalAmount!: string;
}

export class PayrollCalculationSnapshotResponseDto {
  @ApiProperty({ example: '1.0.0' })
  engineVersion!: string;

  @ApiProperty({ example: '2026-04-30T10:00:00.000Z' })
  calculatedAt!: string;

  @ApiProperty({ example: '6745a1b2c3d4e5f678901234' })
  payrollPeriodId!: string;

  @ApiProperty({ example: 'PR-2026-04' })
  periodCode!: string;

  @ApiProperty({ example: 'April 2026 Monthly Payroll' })
  periodName!: string;

  @ApiProperty({ enum: PayrollFrequency })
  payrollFrequency!: PayrollFrequency;

  @ApiProperty({ example: '2026-04-01' })
  startDate!: string;

  @ApiProperty({ example: '2026-04-30' })
  endDate!: string;

  @ApiProperty({ example: 4 })
  month!: number;

  @ApiProperty({ example: 2026 })
  year!: number;

  @ApiProperty({ example: '6745a1b2c3d4e5f678905678' })
  employeeId!: string;

  @ApiProperty({ example: 'EMP001' })
  employeeCode!: string;

  @ApiProperty({ example: 'Jane Doe' })
  employeeName!: string;

  @ApiProperty({ enum: EmploymentStatus })
  employmentStatus!: EmploymentStatus;

  @ApiProperty({ example: '6745a1b2c3d4e5f678909999' })
  salaryAssignmentId!: string;

  @ApiProperty({ example: 0 })
  salaryAssignmentVersion!: number;

  @ApiProperty({ example: '2026-01-01' })
  salaryAssignmentEffectiveFrom!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  salaryAssignmentEffectiveTo!: string | null;

  @ApiProperty({ example: '6745a1b2c3d4e5f678908888' })
  salaryStructureId!: string;

  @ApiProperty({ example: 'ENG_CTC_50K' })
  salaryStructureCode!: string;

  @ApiProperty({ example: 'Standard Engineering CTC' })
  salaryStructureName!: string;

  @ApiProperty({ example: 1 })
  salaryStructureVersion!: number;

  @ApiProperty({ enum: SalaryStructureBasis })
  salaryBasis!: SalaryStructureBasis;

  @ApiProperty({ enum: SalaryStructureFrequency })
  salaryFrequency!: SalaryStructureFrequency;

  @ApiPropertyOptional({ type: String, nullable: true })
  payrollSettingsId!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  payrollSettingsVersion!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  payrollCalculationRuleId!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  payrollCalculationRuleVersion!: number | null;

  @ApiProperty({ example: 'INR' })
  currency!: string;

  @ApiProperty({ enum: PayrollRoundingMode })
  roundingMode!: PayrollRoundingMode;

  @ApiProperty({ example: 2 })
  roundingPrecision!: number;

  @ApiProperty({ enum: PayrollProrationPolicy })
  prorationPolicy!: PayrollProrationPolicy;

  @ApiProperty({ example: true })
  prorateFixedComponents!: boolean;

  @ApiProperty({ example: false })
  prorateDeductions!: boolean;

  @ApiProperty({ example: false })
  prorateEmployerContributions!: boolean;

  @ApiProperty({ enum: NegativeNetPayPolicy })
  negativeNetPayPolicy!: NegativeNetPayPolicy;

  @ApiProperty({ example: 30 })
  calendarDays!: number;

  @ApiProperty({ example: 30 })
  prorationDenominatorDays!: number;

  @ApiProperty({ example: 15 })
  payableDays!: number;

  @ApiProperty({ example: true })
  prorationApplied!: boolean;

  @ApiProperty({ example: '0.5' })
  prorationFactor!: string;

  @ApiProperty({ type: [String], example: ['BASIC', 'HRA', 'PF_EE'] })
  executionOrder!: string[];

  @ApiProperty({ type: [PayrollSnapshotComponentResponseDto] })
  earnings!: PayrollSnapshotComponentResponseDto[];

  @ApiProperty({ type: [PayrollSnapshotComponentResponseDto] })
  deductions!: PayrollSnapshotComponentResponseDto[];

  @ApiProperty({ type: [PayrollSnapshotComponentResponseDto] })
  employerContributions!: PayrollSnapshotComponentResponseDto[];

  @ApiProperty({ type: String, example: '22500.00' })
  grossEarnings!: string;

  @ApiProperty({ type: String, example: '3600.00' })
  totalDeductions!: string;

  @ApiProperty({ type: String, example: '3600.00' })
  employerContributionsTotal!: string;

  @ApiProperty({ type: String, example: '18900.00' })
  netSalary!: string;

  @ApiProperty({ example: false })
  netPayClamped!: boolean;
}

export class PayrollCalculationPreviewResponseDto {
  @ApiProperty({ example: false })
  persisted!: false;

  @ApiProperty({ type: PayrollCalculationSnapshotResponseDto })
  snapshot!: PayrollCalculationSnapshotResponseDto;
}

export class PayrollRecordResponseDto {
  @ApiProperty({ example: '6745a1b2c3d4e5f67890aaaa' })
  id!: string;

  @ApiProperty({ example: true })
  persisted!: true;

  @ApiProperty({ example: '6745a1b2c3d4e5f678901234' })
  payrollPeriodId!: string;

  @ApiProperty({ example: '6745a1b2c3d4e5f678905678' })
  employeeId!: string;

  @ApiProperty({ example: '6745a1b2c3d4e5f678909999' })
  salaryAssignmentId!: string;

  @ApiProperty({ example: '6745a1b2c3d4e5f678908888' })
  salaryStructureId!: string;

  @ApiProperty({ type: String, example: '22500.00' })
  grossEarnings!: string;

  @ApiProperty({ type: String, example: '3600.00' })
  totalDeductions!: string;

  @ApiProperty({ type: String, example: '3600.00' })
  employerContributions!: string;

  @ApiProperty({ type: String, example: '18900.00' })
  netSalary!: string;

  @ApiProperty({ enum: PayrollRecordStatus })
  status!: PayrollRecordStatus;

  @ApiProperty({ example: '2026-04-30T10:00:00.000Z' })
  calculatedAt!: string;

  @ApiProperty({ example: 1 })
  calculationVersion!: number;

  @ApiProperty({ example: 0 })
  version!: number;

  @ApiProperty({ type: PayrollCalculationSnapshotResponseDto })
  calculationSnapshot!: PayrollCalculationSnapshotResponseDto;

  @ApiProperty({ example: '6745a1b2c3d4e5f678900001' })
  createdBy!: string;

  @ApiProperty({ example: '6745a1b2c3d4e5f678900001' })
  updatedBy!: string;

  @ApiProperty({ example: '2026-04-30T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-04-30T10:00:00.000Z' })
  updatedAt!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import {
  SalaryStructureBasis,
  SalaryStructureFrequency,
  StructureComponentCalculationType,
} from '../../salary-structures/constants/salary-structure.constant';
import { SalaryComponentType } from '../../salary-components/constants/salary-component.constant';
import { EmployeeSalaryStatus } from '../constants/employee-salary.constant';

export class SalarySnapshotComponentItemDto {
  @ApiProperty({ example: '60d5ec49f1b2c82d8c8e4567' })
  componentId!: string;

  @ApiProperty({ example: 'Basic Salary' })
  name!: string;

  @ApiProperty({ example: 'BASIC' })
  code!: string;

  @ApiProperty({
    enum: SalaryComponentType,
    example: SalaryComponentType.EARNING,
  })
  type!: SalaryComponentType;

  @ApiProperty({
    enum: StructureComponentCalculationType,
    example: StructureComponentCalculationType.FIXED,
  })
  calculationType!: StructureComponentCalculationType;

  @ApiProperty({ example: 30000, nullable: true })
  amount!: number | null;

  @ApiProperty({ example: null, nullable: true })
  percentage!: number | null;

  @ApiProperty({ example: null, nullable: true })
  percentageOf!: string | null;

  @ApiProperty({ example: 30000 })
  monthlyAmount!: number;

  @ApiProperty({ example: 360000 })
  annualAmount!: number;
}

export class SalarySnapshotSummaryPeriodDto {
  @ApiProperty({ example: 50000 })
  grossSalary!: number;

  @ApiProperty({ example: 3903.75 })
  employerContributions!: number;

  @ApiProperty({ example: 53903.75 })
  totalCtc!: number;

  @ApiProperty({ example: 3000 })
  employeeDeductions!: number;

  @ApiProperty({ example: 47000 })
  estimatedNetSalary!: number;
}

export class SalarySnapshotSummaryDto {
  @ApiProperty({ type: SalarySnapshotSummaryPeriodDto })
  monthly!: SalarySnapshotSummaryPeriodDto;

  @ApiProperty({ type: SalarySnapshotSummaryPeriodDto })
  annual!: SalarySnapshotSummaryPeriodDto;
}

export class SalarySnapshotDto {
  @ApiProperty({
    enum: SalaryStructureBasis,
    example: SalaryStructureBasis.CTC,
  })
  salaryBasis!: SalaryStructureBasis;

  @ApiProperty({
    enum: SalaryStructureFrequency,
    example: SalaryStructureFrequency.MONTHLY,
  })
  salaryFrequency!: SalaryStructureFrequency;

  @ApiProperty({ example: 50000 })
  inputSalaryAmount!: number;

  @ApiProperty({ example: 46096.25 })
  grossSalaryMonthly!: number;

  @ApiProperty({ example: 553155 })
  grossSalaryAnnual!: number;

  @ApiProperty({ example: 3903.75 })
  totalEmployerContributionsMonthly!: number;

  @ApiProperty({ example: 46845 })
  totalEmployerContributionsAnnual!: number;

  @ApiProperty({ example: 50000 })
  totalCtcMonthly!: number;

  @ApiProperty({ example: 600000 })
  totalCtcAnnual!: number;

  @ApiProperty({ example: 3000 })
  totalEmployeeDeductionsMonthly!: number;

  @ApiProperty({ example: 36000 })
  totalEmployeeDeductionsAnnual!: number;

  @ApiProperty({ example: 43096.25 })
  estimatedNetSalaryMonthly!: number;

  @ApiProperty({ example: 517155 })
  estimatedNetSalaryAnnual!: number;

  @ApiProperty({ type: SalarySnapshotSummaryDto })
  summary!: SalarySnapshotSummaryDto;

  @ApiProperty({ type: [SalarySnapshotComponentItemDto] })
  earnings!: SalarySnapshotComponentItemDto[];

  @ApiProperty({ type: [SalarySnapshotComponentItemDto] })
  employeeDeductions!: SalarySnapshotComponentItemDto[];

  @ApiProperty({ type: [SalarySnapshotComponentItemDto] })
  employerContributions!: SalarySnapshotComponentItemDto[];
}

export class EmployeeSalaryResponseDto {
  @ApiProperty({ example: '60d5ec49f1b2c82d8c8e4999' })
  id!: string;

  @ApiProperty({ example: '60d5ec49f1b2c82d8c8e4111' })
  employeeId!: string;

  @ApiProperty({ example: '60d5ec49f1b2c82d8c8e4567' })
  salaryStructureId!: string;

  @ApiProperty({ example: '2026-07-01' })
  effectiveFrom!: string;

  @ApiProperty({ example: null, nullable: true })
  effectiveTo!: string | null;

  @ApiProperty({
    enum: SalaryStructureBasis,
    example: SalaryStructureBasis.CTC,
  })
  salaryBasis!: SalaryStructureBasis;

  @ApiProperty({
    enum: SalaryStructureFrequency,
    example: SalaryStructureFrequency.MONTHLY,
  })
  salaryFrequency!: SalaryStructureFrequency;

  @ApiProperty({ example: 50000 })
  salaryAmount!: number;

  @ApiProperty({ example: 1 })
  salaryStructureVersion!: number;

  @ApiProperty({
    enum: EmployeeSalaryStatus,
    example: EmployeeSalaryStatus.ACTIVE,
  })
  status!: EmployeeSalaryStatus;

  @ApiProperty({ type: SalarySnapshotDto })
  salarySnapshot!: SalarySnapshotDto;

  @ApiProperty({ example: '60d5ec49f1b2c82d8c8e4000' })
  createdBy!: string;

  @ApiProperty({ example: '60d5ec49f1b2c82d8c8e4000' })
  updatedBy!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class EmployeeSalaryListItemDto {
  @ApiProperty({ example: '60d5ec49f1b2c82d8c8e4999' })
  id!: string;

  @ApiProperty({ example: '60d5ec49f1b2c82d8c8e4111' })
  employeeId!: string;

  @ApiProperty({ example: '60d5ec49f1b2c82d8c8e4567' })
  salaryStructureId!: string;

  @ApiProperty({ example: '2026-07-01' })
  effectiveFrom!: string;

  @ApiProperty({ example: null, nullable: true })
  effectiveTo!: string | null;

  @ApiProperty({
    enum: SalaryStructureBasis,
    example: SalaryStructureBasis.CTC,
  })
  salaryBasis!: SalaryStructureBasis;

  @ApiProperty({
    enum: SalaryStructureFrequency,
    example: SalaryStructureFrequency.MONTHLY,
  })
  salaryFrequency!: SalaryStructureFrequency;

  @ApiProperty({ example: 50000 })
  salaryAmount!: number;

  @ApiProperty({
    enum: EmployeeSalaryStatus,
    example: EmployeeSalaryStatus.ACTIVE,
  })
  status!: EmployeeSalaryStatus;

  @ApiProperty({ example: 46096.25 })
  grossSalaryMonthly!: number;

  @ApiProperty({ example: 50000 })
  totalCtcMonthly!: number;

  @ApiProperty({ example: 43096.25 })
  estimatedNetSalaryMonthly!: number;

  @ApiProperty()
  createdAt!: Date;
}

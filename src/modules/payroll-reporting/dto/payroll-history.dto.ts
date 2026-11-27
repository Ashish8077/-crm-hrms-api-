import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PayrollCalculationSnapshotResponseDto } from '../../payroll-calculations/dto/payroll-calculation-response.dto';
import {
  PAYROLL_PERIOD_CONSTANTS,
  PayrollPeriodStatus,
} from '../../payroll-periods/constants/payroll-period.constant';
import { PAYROLL_REPORTING_CONSTANTS } from '../constants/payroll-reporting.constant';

export class ListPayrollHistoryQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: PAYROLL_REPORTING_CONSTANTS.MAX_PAGE_LIMIT,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAYROLL_REPORTING_CONSTANTS.MAX_PAGE_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PAYROLL_PERIOD_CONSTANTS.YEAR_MIN)
  @Max(PAYROLL_PERIOD_CONSTANTS.YEAR_MAX)
  year?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PAYROLL_PERIOD_CONSTANTS.MONTH_MIN)
  @Max(PAYROLL_PERIOD_CONSTANTS.MONTH_MAX)
  month?: number;

  @ApiPropertyOptional({
    enum: PayrollPeriodStatus,
    description:
      'Only FINALIZED periods are exposed in payroll history; non-FINALIZED values return an empty set.',
    example: PayrollPeriodStatus.FINALIZED,
  })
  @IsOptional()
  @IsEnum(PayrollPeriodStatus)
  status?: PayrollPeriodStatus;

  @ApiPropertyOptional({
    description: 'Search by period code or period name (case-insensitive)',
    example: 'PR-2026-04',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ListEmployeePayrollHistoryQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: PAYROLL_REPORTING_CONSTANTS.MAX_PAGE_LIMIT,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAYROLL_REPORTING_CONSTANTS.MAX_PAGE_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PAYROLL_PERIOD_CONSTANTS.YEAR_MIN)
  @Max(PAYROLL_PERIOD_CONSTANTS.YEAR_MAX)
  year?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PAYROLL_PERIOD_CONSTANTS.MONTH_MIN)
  @Max(PAYROLL_PERIOD_CONSTANTS.MONTH_MAX)
  month?: number;
}

export class PayrollHistoryCurrencyTotalsDto {
  @ApiProperty({ example: 'INR' })
  currency!: string;

  @ApiProperty({ example: 120 })
  approvedEmployees!: number;

  @ApiProperty({ example: '6000000.00' })
  totalGrossEarnings!: string;

  @ApiProperty({ example: '300000.00' })
  totalDeductions!: string;

  @ApiProperty({ example: '5700000.00' })
  totalNetSalary!: string;

  @ApiProperty({ example: '240000.00' })
  totalEmployerContributions!: string;

  @ApiProperty({ example: '6240000.00' })
  totalEmployerCost!: string;
}

export class PayrollHistoryListItemDto {
  @ApiProperty()
  periodId!: string;

  @ApiProperty({ example: 'PR-2026-04' })
  periodCode!: string;

  @ApiProperty({ example: 'April 2026 Payroll' })
  periodName!: string;

  @ApiProperty({ example: '2026-04-01' })
  startDate!: string;

  @ApiProperty({ example: '2026-04-30' })
  endDate!: string;

  @ApiProperty({ example: '2026-05-01' })
  paymentDate!: string;

  @ApiProperty({ example: 4 })
  month!: number;

  @ApiProperty({ example: 2026 })
  year!: number;

  @ApiProperty({ enum: PayrollPeriodStatus })
  status!: PayrollPeriodStatus;

  @ApiProperty({ example: 'INR', nullable: true })
  currency!: string | null;

  @ApiProperty({ example: 120 })
  totalEmployees!: number;

  @ApiProperty({ example: '6000000.00' })
  totalGrossEarnings!: string;

  @ApiProperty({ example: '300000.00' })
  totalDeductions!: string;

  @ApiProperty({ example: '5700000.00' })
  totalNetSalary!: string;

  @ApiProperty({ example: '240000.00' })
  totalEmployerContributions!: string;

  @ApiProperty({ example: '6240000.00' })
  totalEmployerCost!: string;

  @ApiProperty()
  finalizedAt!: string;
}

export class PayrollHistoryApprovalInfoDto {
  @ApiProperty({ nullable: true })
  approvedBy!: string | null;

  @ApiProperty({ nullable: true })
  approvedAt!: string | null;

  @ApiProperty({ nullable: true })
  reason!: string | null;

  @ApiProperty()
  acknowledgeAnomalies!: boolean;

  @ApiProperty()
  acknowledgedAnomalyEmployees!: number;

  @ApiProperty({ type: [String] })
  acknowledgedWarningCodes!: string[];
}

export class PayrollHistoryDetailsDto {
  @ApiProperty()
  periodId!: string;

  @ApiProperty()
  periodCode!: string;

  @ApiProperty()
  periodName!: string;

  @ApiProperty()
  payrollFrequency!: string;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiProperty()
  paymentDate!: string;

  @ApiProperty()
  month!: number;

  @ApiProperty()
  year!: number;

  @ApiProperty({ enum: PayrollPeriodStatus })
  status!: PayrollPeriodStatus;

  @ApiProperty()
  finalizedAt!: string;

  @ApiProperty({ nullable: true })
  finalizedBy!: string | null;

  @ApiProperty()
  approvedEmployeeCount!: number;

  @ApiProperty({ description: 'Excluded from all financial totals' })
  excludedInvalidatedCount!: number;

  @ApiProperty()
  generatedPayslipsCount!: number;

  @ApiProperty({ example: 'INR', nullable: true })
  currency!: string | null;

  @ApiProperty()
  totalGrossEarnings!: string;

  @ApiProperty()
  totalDeductions!: string;

  @ApiProperty()
  totalNetSalary!: string;

  @ApiProperty()
  totalEmployerContributions!: string;

  @ApiProperty()
  totalEmployerCost!: string;

  @ApiProperty({ type: [PayrollHistoryCurrencyTotalsDto] })
  totalsByCurrency!: PayrollHistoryCurrencyTotalsDto[];

  @ApiProperty({ type: PayrollHistoryApprovalInfoDto, nullable: true })
  approval!: PayrollHistoryApprovalInfoDto | null;
}

export class EmployeePayrollHistoryItemDto {
  @ApiProperty()
  periodId!: string;

  @ApiProperty()
  periodCode!: string;

  @ApiProperty()
  periodName!: string;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiProperty()
  paymentDate!: string;

  @ApiProperty()
  month!: number;

  @ApiProperty()
  year!: number;

  @ApiProperty()
  grossEarnings!: string;

  @ApiProperty()
  totalDeductions!: string;

  @ApiProperty()
  employerContributions!: string;

  @ApiProperty()
  employerCost!: string;

  @ApiProperty()
  netSalary!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  payrollRecordId!: string;

  @ApiProperty()
  payrollCalculationVersion!: number;

  @ApiProperty()
  payslipAvailable!: boolean;
}

export class EmployeePayrollHistoryDetailsDto {
  @ApiProperty()
  periodId!: string;

  @ApiProperty()
  periodCode!: string;

  @ApiProperty()
  periodName!: string;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiProperty()
  paymentDate!: string;

  @ApiProperty()
  month!: number;

  @ApiProperty()
  year!: number;

  @ApiProperty()
  finalizedAt!: string;

  @ApiProperty()
  payrollRecordId!: string;

  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  payrollCalculationVersion!: number;

  @ApiProperty()
  payslipAvailable!: boolean;

  @ApiProperty()
  grossEarnings!: string;

  @ApiProperty()
  totalDeductions!: string;

  @ApiProperty()
  employerContributions!: string;

  @ApiProperty()
  employerCost!: string;

  @ApiProperty()
  netSalary!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  lopSummary!: {
    calendarDays: number;
    payableDays: number;
    presentDays: number;
    halfDays: number;
    paidLeaveDays: number;
    unpaidLeaveDays: number;
    unpaidLeaveLopDays: number;
    attendanceAbsenceDays: number;
    attendanceAbsenceLopDays: number;
    halfDayDeductions: number;
    totalLopDays: number;
  };

  @ApiProperty({ type: PayrollCalculationSnapshotResponseDto })
  calculationSnapshot!: PayrollCalculationSnapshotResponseDto;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  PAYROLL_SETTINGS_CONSTANTS,
  PayrollFrequency,
  SUPPORTED_PAYROLL_CURRENCIES,
  WorkingDaysPolicy,
} from '../constants/payroll-configuration.constant';

export class UpdatePayrollSettingsDto {
  @ApiPropertyOptional({
    description: 'Payroll currency code (ISO 4217)',
    enum: SUPPORTED_PAYROLL_CURRENCIES,
    example: 'INR',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_PAYROLL_CURRENCIES)
  currency?: string;

  @ApiPropertyOptional({
    description: 'Payroll processing frequency',
    enum: PayrollFrequency,
    example: PayrollFrequency.MONTHLY,
  })
  @IsOptional()
  @IsEnum(PayrollFrequency)
  payrollFrequency?: PayrollFrequency;

  @ApiPropertyOptional({
    description: 'Monthly payroll attendance/input cutoff day (1-28)',
    example: 25,
    minimum: PAYROLL_SETTINGS_CONSTANTS.CUTOFF_DAY_MIN,
    maximum: PAYROLL_SETTINGS_CONSTANTS.CUTOFF_DAY_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(PAYROLL_SETTINGS_CONSTANTS.CUTOFF_DAY_MIN)
  @Max(PAYROLL_SETTINGS_CONSTANTS.CUTOFF_DAY_MAX)
  cutoffDay?: number;

  @ApiPropertyOptional({
    description: 'Default salary payment day of the month (1-31)',
    example: 1,
    minimum: PAYROLL_SETTINGS_CONSTANTS.PAYMENT_DAY_MIN,
    maximum: PAYROLL_SETTINGS_CONSTANTS.PAYMENT_DAY_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(PAYROLL_SETTINGS_CONSTANTS.PAYMENT_DAY_MIN)
  @Max(PAYROLL_SETTINGS_CONSTANTS.PAYMENT_DAY_MAX)
  paymentDay?: number;

  @ApiPropertyOptional({
    description: 'Financial year start month (1 = January, 4 = April)',
    example: 4,
    minimum: PAYROLL_SETTINGS_CONSTANTS.FY_START_MONTH_MIN,
    maximum: PAYROLL_SETTINGS_CONSTANTS.FY_START_MONTH_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(PAYROLL_SETTINGS_CONSTANTS.FY_START_MONTH_MIN)
  @Max(PAYROLL_SETTINGS_CONSTANTS.FY_START_MONTH_MAX)
  financialYearStartMonth?: number;

  @ApiPropertyOptional({
    description: 'Default working days calculation policy',
    enum: WorkingDaysPolicy,
    example: WorkingDaysPolicy.CALENDAR_DAYS,
  })
  @IsOptional()
  @IsEnum(WorkingDaysPolicy)
  workingDaysPolicy?: WorkingDaysPolicy;

  @ApiPropertyOptional({
    description:
      'Fixed working days per month (used when workingDaysPolicy is FIXED_WORKING_DAYS)',
    example: 26,
    nullable: true,
    minimum: PAYROLL_SETTINGS_CONSTANTS.FIXED_WORKING_DAYS_MIN,
    maximum: PAYROLL_SETTINGS_CONSTANTS.FIXED_WORKING_DAYS_MAX,
  })
  @IsOptional()
  @ValidateIf(
    (obj: UpdatePayrollSettingsDto) => obj.fixedWorkingDaysPerMonth !== null,
  )
  @IsInt()
  @Min(PAYROLL_SETTINGS_CONSTANTS.FIXED_WORKING_DAYS_MIN)
  @Max(PAYROLL_SETTINGS_CONSTANTS.FIXED_WORKING_DAYS_MAX)
  fixedWorkingDaysPerMonth?: number | null;

  @ApiPropertyOptional({
    description: 'Enable or disable payroll processing globally',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isPayrollProcessingEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Expected document version for optimistic concurrency control',
    example: 0,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PAYROLL_PERIOD_CONSTANTS } from '../constants/payroll-period.constant';
import { TrimString } from '../../../common/decorators/trim-string.decorator';

export class UpdatePayrollPeriodDto {
  @ApiPropertyOptional({
    description: 'Updated descriptive name for the payroll period',
    example: 'January 2026 Monthly Payroll - Revised',
    minLength: PAYROLL_PERIOD_CONSTANTS.NAME_MIN_LENGTH,
    maxLength: PAYROLL_PERIOD_CONSTANTS.NAME_MAX_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MinLength(PAYROLL_PERIOD_CONSTANTS.NAME_MIN_LENGTH)
  @MaxLength(PAYROLL_PERIOD_CONSTANTS.NAME_MAX_LENGTH)
  periodName?: string;

  @ApiPropertyOptional({
    description: 'Updated start date of the payroll period (YYYY-MM-DD)',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'startDate must be a valid ISO-8601 date string (YYYY-MM-DD)' },
  )
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Updated end date of the payroll period (YYYY-MM-DD)',
    example: '2026-01-31',
  })
  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'endDate must be a valid ISO-8601 date string (YYYY-MM-DD)' },
  )
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Updated scheduled salary payment date (YYYY-MM-DD)',
    example: '2026-02-01',
  })
  @IsOptional()
  @IsDateString(
    { strict: true },
    {
      message: 'paymentDate must be a valid ISO-8601 date string (YYYY-MM-DD)',
    },
  )
  paymentDate?: string;

  @ApiPropertyOptional({
    description: 'Operational notes or remarks for this period',
    example: 'Dates adjusted for company holiday calendar',
    maxLength: PAYROLL_PERIOD_CONSTANTS.NOTES_MAX_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(PAYROLL_PERIOD_CONSTANTS.NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Current document version (__v) for optimistic concurrency control',
    example: 0,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}

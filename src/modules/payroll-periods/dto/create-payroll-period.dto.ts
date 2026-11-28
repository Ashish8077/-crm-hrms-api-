import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PayrollFrequency } from '../../payroll-configuration/constants/payroll-configuration.constant';
import { PAYROLL_PERIOD_CONSTANTS } from '../constants/payroll-period.constant';
import { TrimString } from '../../../common/decorators/trim-string.decorator';

export class CreatePayrollPeriodDto {
  @ApiProperty({
    description: 'Descriptive human-readable name for the payroll period',
    example: 'January 2026 Regular Monthly Payroll',
    minLength: PAYROLL_PERIOD_CONSTANTS.NAME_MIN_LENGTH,
    maxLength: PAYROLL_PERIOD_CONSTANTS.NAME_MAX_LENGTH,
  })
  @IsNotEmpty()
  @TrimString()
  @IsString()
  @MinLength(PAYROLL_PERIOD_CONSTANTS.NAME_MIN_LENGTH)
  @MaxLength(PAYROLL_PERIOD_CONSTANTS.NAME_MAX_LENGTH)
  periodName!: string;

  @ApiPropertyOptional({
    description:
      'Unique uppercase alphanumeric code for the payroll period (auto-generated if omitted: PR-YYYY-MM)',
    example: 'PR-2026-01',
    minLength: PAYROLL_PERIOD_CONSTANTS.CODE_MIN_LENGTH,
    maxLength: PAYROLL_PERIOD_CONSTANTS.CODE_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MinLength(PAYROLL_PERIOD_CONSTANTS.CODE_MIN_LENGTH)
  @MaxLength(PAYROLL_PERIOD_CONSTANTS.CODE_MAX_LENGTH)
  @Matches(/^[A-Z0-9_-]+$/, {
    message:
      'periodCode must contain only uppercase alphanumeric characters, hyphens, or underscores',
  })
  periodCode?: string;

  @ApiProperty({
    description: 'Start date of the payroll period (inclusive, YYYY-MM-DD)',
    example: '2026-01-01',
  })
  @IsNotEmpty()
  @IsDateString(
    { strict: true },
    { message: 'startDate must be a valid ISO-8601 date string (YYYY-MM-DD)' },
  )
  startDate!: string;

  @ApiProperty({
    description: 'End date of the payroll period (inclusive, YYYY-MM-DD)',
    example: '2026-01-31',
  })
  @IsNotEmpty()
  @IsDateString(
    { strict: true },
    { message: 'endDate must be a valid ISO-8601 date string (YYYY-MM-DD)' },
  )
  endDate!: string;

  @ApiProperty({
    description:
      'Scheduled salary disbursement date for this period (YYYY-MM-DD)',
    example: '2026-02-01',
  })
  @IsNotEmpty()
  @IsDateString(
    { strict: true },
    {
      message: 'paymentDate must be a valid ISO-8601 date string (YYYY-MM-DD)',
    },
  )
  paymentDate!: string;

  @ApiProperty({
    description: 'Calendar month number of the payroll period (1 to 12)',
    example: 1,
    minimum: PAYROLL_PERIOD_CONSTANTS.MONTH_MIN,
    maximum: PAYROLL_PERIOD_CONSTANTS.MONTH_MAX,
  })
  @IsNotEmpty()
  @IsInt()
  @Min(PAYROLL_PERIOD_CONSTANTS.MONTH_MIN)
  @Max(PAYROLL_PERIOD_CONSTANTS.MONTH_MAX)
  month!: number;

  @ApiProperty({
    description: 'Calendar year of the payroll period',
    example: 2026,
    minimum: PAYROLL_PERIOD_CONSTANTS.YEAR_MIN,
    maximum: PAYROLL_PERIOD_CONSTANTS.YEAR_MAX,
  })
  @IsNotEmpty()
  @IsInt()
  @Min(PAYROLL_PERIOD_CONSTANTS.YEAR_MIN)
  @Max(PAYROLL_PERIOD_CONSTANTS.YEAR_MAX)
  year!: number;

  @ApiPropertyOptional({
    description:
      'Payroll frequency (inherits company settings configuration if omitted)',
    enum: PayrollFrequency,
    example: PayrollFrequency.MONTHLY,
  })
  @IsOptional()
  @IsEnum(PayrollFrequency)
  payrollFrequency?: PayrollFrequency;

  @ApiPropertyOptional({
    description: 'Optional operational or cycle remarks',
    example: 'Standard end of month salary run',
    maxLength: PAYROLL_PERIOD_CONSTANTS.NOTES_MAX_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(PAYROLL_PERIOD_CONSTANTS.NOTES_MAX_LENGTH)
  notes?: string;
}

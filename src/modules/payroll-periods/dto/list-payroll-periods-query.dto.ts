import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import { PayrollFrequency } from '../../payroll-configuration/constants/payroll-configuration.constant';
import {
  PAYROLL_PERIOD_CONSTANTS,
  PAYROLL_PERIOD_SORTABLE_FIELDS,
  PayrollPeriodStatus,
} from '../constants/payroll-period.constant';

export class ListPayrollPeriodsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Search by period name or code (case-insensitive substring match)',
    example: 'January',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by calendar year',
    example: 2026,
    minimum: PAYROLL_PERIOD_CONSTANTS.YEAR_MIN,
    maximum: PAYROLL_PERIOD_CONSTANTS.YEAR_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PAYROLL_PERIOD_CONSTANTS.YEAR_MIN)
  @Max(PAYROLL_PERIOD_CONSTANTS.YEAR_MAX)
  year?: number;

  @ApiPropertyOptional({
    description: 'Filter by calendar month (1 to 12)',
    example: 1,
    minimum: PAYROLL_PERIOD_CONSTANTS.MONTH_MIN,
    maximum: PAYROLL_PERIOD_CONSTANTS.MONTH_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PAYROLL_PERIOD_CONSTANTS.MONTH_MIN)
  @Max(PAYROLL_PERIOD_CONSTANTS.MONTH_MAX)
  month?: number;

  @ApiPropertyOptional({
    description: 'Filter by period status',
    enum: PayrollPeriodStatus,
    example: PayrollPeriodStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(PayrollPeriodStatus)
  status?: PayrollPeriodStatus;

  @ApiPropertyOptional({
    description: 'Filter by payroll frequency',
    enum: PayrollFrequency,
    example: PayrollFrequency.MONTHLY,
  })
  @IsOptional()
  @IsEnum(PayrollFrequency)
  payrollFrequency?: PayrollFrequency;

  @ApiPropertyOptional({
    description: 'Field to sort results by',
    enum: PAYROLL_PERIOD_SORTABLE_FIELDS,
    default: 'startDate',
  })
  @IsOptional()
  @IsIn(PAYROLL_PERIOD_SORTABLE_FIELDS)
  sortBy?: string = 'startDate';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

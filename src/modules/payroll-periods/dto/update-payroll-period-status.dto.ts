import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PAYROLL_PERIOD_CONSTANTS,
  PayrollPeriodStatus,
} from '../constants/payroll-period.constant';
import { TrimString } from '../../../common/decorators/trim-string.decorator';

export class UpdatePayrollPeriodStatusDto {
  @ApiProperty({
    description:
      'Target status transition for the payroll period (DRAFT -> PROCESSING -> COMPLETED -> FINALIZED)',
    enum: PayrollPeriodStatus,
    example: PayrollPeriodStatus.PROCESSING,
  })
  @IsNotEmpty()
  @IsEnum(PayrollPeriodStatus)
  status!: PayrollPeriodStatus;

  @ApiPropertyOptional({
    description:
      'Optional operational reason or justification for this transition',
    example: 'Initiating batch salary calculation for January 2026',
    maxLength: PAYROLL_PERIOD_CONSTANTS.NOTES_MAX_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(PAYROLL_PERIOD_CONSTANTS.NOTES_MAX_LENGTH)
  reason?: string;

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

import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReconcileCancellationAction } from '../constants/leaves.constant';

export class ReconcileYearSplitDto {
  @ApiProperty({
    description: 'Calendar year for the balance split',
    example: 2026,
  })
  @IsNotEmpty({ message: 'Year is required for yearBreakdown split' })
  @IsNumber({}, { message: 'Year must be a number' })
  year!: number;

  @ApiProperty({
    description: 'Eligible leave days to refund for this calendar year',
    example: 1.5,
    minimum: 0,
  })
  @IsNotEmpty({ message: 'Days is required for yearBreakdown split' })
  @IsNumber({}, { message: 'Days must be a number' })
  @Min(0, { message: 'Refunded days for a year cannot be negative' })
  days!: number;
}

export class ReconcileLeaveCancellationDto {
  @ApiProperty({
    enum: ReconcileCancellationAction,
    description:
      'Reconciliation decision: APPROVE cancellation (refund eligible days) or REJECT cancellation (revert to APPROVED)',
    example: ReconcileCancellationAction.APPROVE,
  })
  @IsNotEmpty({ message: 'Action is required (APPROVE or REJECT)' })
  @IsEnum(ReconcileCancellationAction, {
    message: 'Action must be either APPROVE or REJECT',
  })
  action!: ReconcileCancellationAction;

  @ApiProperty({
    description: 'Mandatory HR reconciliation remarks / justification',
    example:
      'Verified employee attendance on 2026-06-01; approving partial cancellation for 1 day.',
  })
  @IsNotEmpty({ message: 'Reconciliation remarks are required' })
  @IsString({ message: 'Remarks must be a string' })
  @MinLength(5, { message: 'Remarks must be at least 5 characters long' })
  @MaxLength(500, { message: 'Remarks cannot exceed 500 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .replace(/<[^>]*>/g, '')
          .trim()
          .slice(0, 500)
      : value,
  )
  remarks!: string;

  @ApiProperty({
    description:
      'Mandatory details of verified actual attendance records or punch logs',
    example:
      'Biometric punch logs present for 2026-06-01: In 09:02, Out 18:05. Verified with branch manager.',
  })
  @IsNotEmpty({ message: 'Actual attendance details are required' })
  @IsString({ message: 'Actual attendance details must be a string' })
  @MinLength(5, {
    message: 'Actual attendance details must be at least 5 characters long',
  })
  @MaxLength(1000, {
    message: 'Actual attendance details cannot exceed 1000 characters',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .replace(/<[^>]*>/g, '')
          .trim()
          .slice(0, 1000)
      : value,
  )
  actualAttendanceDetails!: string;

  @ApiPropertyOptional({
    description:
      'Total eligible leave days to refund (for single-year leave or overall total)',
    example: 1,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'Refunded days must be a number' })
  @Min(0, { message: 'Refunded days cannot be negative' })
  refundedDays?: number;

  @ApiPropertyOptional({
    description:
      'Specific per-year breakdown of days to refund (required for cross-year partial cancellation)',
    type: [ReconcileYearSplitDto],
  })
  @IsOptional()
  @IsArray({ message: 'yearBreakdown must be an array' })
  @ValidateNested({ each: true })
  @Type(() => ReconcileYearSplitDto)
  yearBreakdown?: ReconcileYearSplitDto[];

  @ApiPropertyOptional({
    description:
      'Specific dates verified as worked by the employee (YYYY-MM-DD)',
    example: ['2026-06-01'],
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'datesWorked must be an array of date strings' })
  @IsString({
    each: true,
    message: 'Each date in datesWorked must be a string',
  })
  datesWorked?: string[];

  @ApiPropertyOptional({
    description:
      'Flag indicating whether payroll has already been finalized/processed for this period',
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'isPayrollProcessed must be a boolean' })
  isPayrollProcessed?: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  PayrollPeriodStatus,
  PayrollProcessingStatus,
} from '../../payroll-periods/constants/payroll-period.constant';
import { PAYROLL_PROCESSING_CONSTANTS } from '../constants/payroll-calculation.constant';

export class ProcessPayrollPeriodDto {
  @ApiPropertyOptional({
    description:
      'Optional bounded batch size per chunk during payroll execution (default 50, range 10..200).',
    example: 50,
    minimum: PAYROLL_PROCESSING_CONSTANTS.MIN_BATCH_SIZE,
    maximum: PAYROLL_PROCESSING_CONSTANTS.MAX_BATCH_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'batchSize must be an integer' })
  @Min(PAYROLL_PROCESSING_CONSTANTS.MIN_BATCH_SIZE, {
    message: `batchSize must be at least ${PAYROLL_PROCESSING_CONSTANTS.MIN_BATCH_SIZE}`,
  })
  @Max(PAYROLL_PROCESSING_CONSTANTS.MAX_BATCH_SIZE, {
    message: `batchSize cannot exceed ${PAYROLL_PROCESSING_CONSTANTS.MAX_BATCH_SIZE}`,
  })
  batchSize?: number;
}

export class ListPayrollProcessingFailuresQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PayrollProcessingFailureItemDto {
  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  employeeCode!: string;

  @ApiProperty()
  employeeName!: string;

  @ApiProperty()
  errorCode!: string;

  @ApiProperty()
  errorMessage!: string;

  @ApiProperty()
  attemptNumber!: number;

  @ApiProperty()
  lastAttemptAt!: string;
}

export class PayrollPeriodProcessingStatusResponseDto {
  @ApiProperty()
  payrollPeriodId!: string;

  @ApiProperty()
  periodCode!: string;

  @ApiProperty({ enum: PayrollPeriodStatus })
  periodStatus!: PayrollPeriodStatus;

  @ApiProperty({ enum: PayrollProcessingStatus })
  processingStatus!: PayrollProcessingStatus;

  @ApiProperty()
  totalEligibleEmployees!: number;

  @ApiProperty()
  processedEmployees!: number;

  @ApiProperty()
  successfulEmployees!: number;

  @ApiProperty()
  failedEmployees!: number;

  @ApiProperty()
  remainingEmployees!: number;

  @ApiProperty()
  staleEmployees!: number;

  @ApiProperty()
  skippedUpToDateEmployees!: number;

  @ApiProperty()
  recalculatedEmployees!: number;

  @ApiProperty()
  processingAttempts!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  startedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  completedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  lastAttemptAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  lastErrorSummary!: string | null;

  @ApiProperty()
  canRetry!: boolean;

  @ApiProperty()
  canComplete!: boolean;
}

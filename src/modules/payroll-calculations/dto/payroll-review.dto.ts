import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import {
  PAYROLL_PERIOD_CONSTANTS,
  PayrollPeriodStatus,
  PayrollProcessingStatus,
} from '../../payroll-periods/constants/payroll-period.constant';
import { PayrollRecordStatus } from '../constants/payroll-calculation.constant';
import { PayrollRecordResponseDto } from './payroll-calculation-response.dto';

export class ListPayrollReviewRecordsQueryDto {
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

  @ApiPropertyOptional({
    description: 'Search by employee code or name',
    example: 'EMP001',
    maxLength: 100,
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by department ObjectId',
    example: '6745a1b2c3d4e5f678900010',
  })
  @IsOptional()
  @IsMongoId()
  departmentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by branch ObjectId',
    example: '6745a1b2c3d4e5f678900011',
  })
  @IsOptional()
  @IsMongoId()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'Filter by payroll record status',
    enum: PayrollRecordStatus,
  })
  @IsOptional()
  @IsEnum(PayrollRecordStatus)
  status?: PayrollRecordStatus;

  @ApiPropertyOptional({
    description: 'Filter records with or without leave/attendance anomalies',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean({ message: 'hasAnomalies must be a boolean' })
  hasAnomalies?: boolean;
}

export class ApprovePayrollPeriodDto {
  @ApiPropertyOptional({
    description:
      'Approval notes or justification (mandatory with at least 5 characters when acknowledging non-blocking anomalies).',
    example: 'Reviewed all salary figures, LOP deductions, and anomaly notes.',
    maxLength: PAYROLL_PERIOD_CONSTANTS.NOTES_MAX_LENGTH,
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(PAYROLL_PERIOD_CONSTANTS.NOTES_MAX_LENGTH)
  reason?: string;

  @ApiPropertyOptional({
    description:
      'Explicitly acknowledge non-blocking reviewable attendance/leave anomalies when approving.',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'acknowledgeAnomalies must be a boolean' })
  acknowledgeAnomalies?: boolean;

  @ApiPropertyOptional({
    description:
      'Optional expected PayrollPeriod document version (__v) for strict optimistic review locking.',
    example: 2,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}

export class PayrollReviewAttentionEmployeeDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  employeeId!: string | null;

  @ApiProperty()
  employeeCode!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  employeeName!: string | null;

  @ApiProperty({
    enum: [
      'PROCESSING_FAILURE',
      'STALE_RECORD',
      'UNPROCESSED',
      'INELIGIBLE_ACTIVE_RECORD',
      'BLOCKING_ANOMALY',
      'REVIEWABLE_ANOMALY',
    ],
  })
  issueType!:
    | 'PROCESSING_FAILURE'
    | 'STALE_RECORD'
    | 'UNPROCESSED'
    | 'INELIGIBLE_ACTIVE_RECORD'
    | 'BLOCKING_ANOMALY'
    | 'REVIEWABLE_ANOMALY';

  @ApiProperty()
  severity!: 'BLOCKING' | 'WARNING';

  @ApiProperty()
  message!: string;

  @ApiProperty({ type: [String] })
  codes!: string[];
}

export class PayrollReviewSummaryResponseDto {
  @ApiProperty()
  period!: {
    id: string;
    periodCode: string;
    periodName: string;
    payrollFrequency: string;
    startDate: string;
    endDate: string;
    paymentDate: string;
    month: number;
    year: number;
    version: number;
  };

  @ApiProperty({ enum: PayrollPeriodStatus })
  periodStatus!: PayrollPeriodStatus;

  @ApiProperty({ enum: PayrollProcessingStatus })
  processingStatus!: PayrollProcessingStatus;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  totalEligibleEmployees!: number;

  @ApiProperty()
  totalCalculatedEmployees!: number;

  @ApiProperty()
  totalApprovedEmployees!: number;

  @ApiProperty()
  totalPendingApprovalEmployees!: number;

  @ApiProperty()
  totalInvalidatedEmployees!: number;

  @ApiProperty()
  totalProcessingFailures!: number;

  @ApiProperty({ example: '450000.00' })
  totalGrossEarnings!: string;

  @ApiProperty({ example: '36000.00' })
  totalEmployeeDeductions!: string;

  @ApiProperty({ example: '414000.00' })
  totalNetSalary!: string;

  @ApiProperty({ example: '36000.00' })
  totalEmployerContributions!: string;

  @ApiProperty({ example: '486000.00' })
  totalEmployerCost!: string;

  @ApiProperty({ type: [PayrollReviewAttentionEmployeeDto] })
  employeesRequiringAttention!: PayrollReviewAttentionEmployeeDto[];

  @ApiProperty()
  readiness!: {
    isProcessingActive: boolean;
    unprocessedCount: number;
    staleCount: number;
    unresolvedFailuresCount: number;
    ineligibleRecordsCount: number;
    hasBlockingAnomalies: boolean;
    reviewableAnomalyCount: number;
    blockingWarningCodes: string[];
    reviewableWarningCodes: string[];
  };

  @ApiProperty()
  approvalEligibility!: {
    canApprove: boolean;
    alreadyApproved: boolean;
    requiresAnomalyAcknowledgment: boolean;
    blockingReasons: string[];
  };

  @ApiPropertyOptional({ type: Object, nullable: true })
  approval!: Record<string, unknown> | null;
}

export class PayrollReviewRecordListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  employeeCode!: string;

  @ApiProperty()
  employeeName!: string;

  @ApiProperty()
  employmentStatus!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  departmentId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiProperty({ enum: PayrollRecordStatus })
  status!: PayrollRecordStatus;

  @ApiProperty()
  grossEarnings!: string;

  @ApiProperty()
  employeeDeductions!: string;

  @ApiProperty()
  netSalary!: string;

  @ApiProperty()
  employerContributions!: string;

  @ApiProperty()
  employerCost!: string;

  @ApiProperty()
  payableDays!: number;

  @ApiProperty()
  lopDays!: number;

  @ApiProperty()
  calculationVersion!: number;

  @ApiProperty()
  calculatedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  approvedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  approvedBy!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  invalidatedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  invalidationReason!: string | null;

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ type: [String] })
  leaveAttendanceMismatchDates!: string[];
}

export class PayrollReviewRecordDetailResponseDto extends PayrollRecordResponseDto {
  @ApiProperty()
  employerCost!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  approvedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  approvedBy!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  invalidatedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  invalidatedBy!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  invalidationReason!: string | null;

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ type: [String] })
  leaveAttendanceMismatchDates!: string[];
}

export class ApprovePayrollPeriodResponseDto {
  @ApiProperty()
  payrollPeriodId!: string;

  @ApiProperty()
  periodCode!: string;

  @ApiProperty({ enum: PayrollPeriodStatus })
  periodStatus!: PayrollPeriodStatus;

  @ApiProperty()
  approvedRecordsCount!: number;

  @ApiProperty()
  alreadyApprovedRecordsCount!: number;

  @ApiProperty()
  approvedBy!: string;

  @ApiProperty()
  approvedAt!: string;

  @ApiProperty()
  totalGrossEarnings!: string;

  @ApiProperty()
  totalEmployeeDeductions!: string;

  @ApiProperty()
  totalEmployerContributions!: string;

  @ApiProperty()
  totalNetSalary!: string;

  @ApiProperty()
  totalEmployerCost!: string;

  @ApiProperty({ type: Object })
  calculationVersionsApproved!: Record<string, number>;

  @ApiProperty()
  eligibleForFinalization!: boolean;

  @ApiProperty()
  version!: number;
}

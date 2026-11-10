import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RegularizationStatus } from '../constants/attendance.constant';

export class UpdateRegularizationStatusDto {
  @ApiProperty({
    description:
      'Target status for regularization request (APPROVED or REJECTED)',
    enum: [RegularizationStatus.APPROVED, RegularizationStatus.REJECTED],
    example: RegularizationStatus.APPROVED,
  })
  @IsNotEmpty({ message: 'Status is required' })
  @IsIn([RegularizationStatus.APPROVED, RegularizationStatus.REJECTED], {
    message: 'Status must be either APPROVED or REJECTED',
  })
  status: RegularizationStatus;

  @ApiPropertyOptional({
    description:
      'Comments or audit justification for status transition (per REST Option 2: { comments })',
    example: 'Approved, generating attendance record.',
  })
  @IsOptional()
  @IsString()
  comments?: string;

  @ApiPropertyOptional({
    description: 'Approval notes',
    example: 'Approved per email confirmation.',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Rejection reason',
    example: 'No evidence provided.',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Review remarks',
    example: 'Verified with team lead.',
  })
  @IsOptional()
  @IsString()
  reviewRemarks?: string;

  /**
   * Helper to resolve the effective remarks across any provided alias.
   */
  static resolveRemarks(
    dto?: Partial<UpdateRegularizationStatusDto> | null,
  ): string | undefined {
    if (!dto) return undefined;
    return (
      dto.comments ?? dto.notes ?? dto.reason ?? dto.reviewRemarks ?? undefined
    );
  }
}

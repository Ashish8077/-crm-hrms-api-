import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewRegularizationDto {
  @ApiPropertyOptional({
    description: 'Remarks or feedback from reviewing manager/admin',
    example: 'Approved after verification with team lead',
  })
  @IsOptional()
  @IsString()
  reviewRemarks?: string;

  @ApiPropertyOptional({
    description: 'Optional approval notes (per REST Option 1: { notes })',
    example: 'Approved per email confirmation.',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Rejection reason or review notes (per REST Option 1: { reason })',
    example: 'No evidence provided.',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Review comments (per REST Option 2: { comments })',
    example: 'Approved, generating attendance record.',
  })
  @IsOptional()
  @IsString()
  comments?: string;

  /**
   * Helper to resolve the effective remarks across any provided alias.
   */
  static resolveRemarks(
    dto?: Partial<ReviewRegularizationDto> | null,
  ): string | undefined {
    if (!dto) return undefined;
    return dto.reviewRemarks ?? dto.notes ?? dto.reason ?? dto.comments;
  }
}

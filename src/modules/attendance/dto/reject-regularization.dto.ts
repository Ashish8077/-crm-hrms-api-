import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RejectRegularizationDto {
  @ApiProperty({
    description:
      'Required audit reason for rejecting regularization request (per REST Option 1: { reason })',
    example: 'No evidence provided.',
  })
  @IsNotEmpty({ message: 'Rejection reason is required' })
  @IsString()
  reason: string;

  @ApiPropertyOptional({
    description: 'Alternative alias for review remarks',
    example: 'Rejected per internal review',
  })
  @IsOptional()
  @IsString()
  reviewRemarks?: string;

  @ApiPropertyOptional({
    description: 'Optional review notes',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Optional review comments',
  })
  @IsOptional()
  @IsString()
  comments?: string;

  /**
   * Helper to resolve the effective remarks across any provided alias.
   */
  static resolveRemarks(
    dto?: Partial<RejectRegularizationDto> | null,
  ): string | undefined {
    if (!dto) return undefined;
    return dto.reason ?? dto.reviewRemarks ?? dto.notes ?? dto.comments;
  }
}

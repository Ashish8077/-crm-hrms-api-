import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SubmitApprovalDto {
  @ApiPropertyOptional({
    description:
      'Note to the approving manager explaining discount or margin justification',
    example:
      'Special discount requested for strategic enterprise multi-year commitment',
  })
  @IsOptional()
  @IsString()
  requestNote?: string;

  @ApiPropertyOptional({ description: 'Notes alias' })
  @IsOptional()
  @IsString()
  notes?: string;
}

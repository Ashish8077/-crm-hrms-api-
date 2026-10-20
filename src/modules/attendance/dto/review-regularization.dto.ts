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
}

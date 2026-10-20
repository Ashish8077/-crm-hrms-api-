import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class EndBreakDto {
  @ApiPropertyOptional({ description: 'Optional concluding break note' })
  @IsOptional()
  @IsString()
  note?: string;
}

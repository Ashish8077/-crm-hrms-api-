import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CheckDuplicateContactDto {
  @ApiPropertyOptional({ example: 'robert.chen@acme.com' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '+1-512-555-0144' })
  @IsString()
  @IsOptional()
  phone?: string;
}

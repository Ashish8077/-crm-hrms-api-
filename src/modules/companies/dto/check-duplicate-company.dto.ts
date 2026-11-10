import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CheckDuplicateCompanyDto {
  @ApiPropertyOptional({ example: 'CIN-U72200DL2026PTC123456' })
  @IsString()
  @IsOptional()
  registrationNumber?: string;

  @ApiPropertyOptional({ example: 'TX-998877' })
  @IsString()
  @IsOptional()
  taxId?: string;

  @ApiPropertyOptional({ example: 'acmeinnovations.com' })
  @IsString()
  @IsOptional()
  domain?: string;

  @ApiPropertyOptional({ example: 'contact@acmeinnovations.com' })
  @IsString()
  @IsOptional()
  email?: string;
}

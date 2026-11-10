import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsMongoId,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

export class LinkCompanyDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Company ID to link',
  })
  @IsMongoId()
  @IsNotEmpty()
  companyId!: string;

  @ApiPropertyOptional({
    example: true,
    description: 'True to set this contact as primary for the company',
  })
  @IsBoolean()
  @IsOptional()
  isPrimaryContact?: boolean;

  @ApiPropertyOptional({ example: 'Head of Procurement' })
  @IsString()
  @IsOptional()
  jobTitle?: string;

  @ApiPropertyOptional({ example: 'Operations' })
  @IsString()
  @IsOptional()
  department?: string;
}

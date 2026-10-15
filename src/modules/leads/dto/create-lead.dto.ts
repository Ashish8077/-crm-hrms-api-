import {
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import { LeadSource } from '../constants/lead-source.constant';
import { LeadStatus } from '../constants/lead-status.constant';

export class CreateLeadDto {
  @ApiProperty({ description: 'Lead first name', example: 'John' })
  @IsNotEmpty()
  @IsString()
  @TrimString()
  firstName!: string;

  @ApiProperty({ description: 'Lead last name', example: 'Doe' })
  @IsNotEmpty()
  @IsString()
  @TrimString()
  lastName!: string;

  @ApiProperty({
    description: 'Lead email address',
    example: 'john.doe@example.com',
  })
  @IsNotEmpty()
  @IsEmail()
  @TrimString()
  email!: string;

  @ApiProperty({ description: 'Lead phone number', example: '+1234567890' })
  @IsNotEmpty()
  @IsString()
  @TrimString()
  phone!: string;

  @ApiPropertyOptional({ description: 'Company name', example: 'Acme Corp' })
  @IsOptional()
  @IsString()
  @TrimString()
  companyName?: string;

  @ApiPropertyOptional({
    description: 'Job title / Designation',
    example: 'CTO',
  })
  @IsOptional()
  @IsString()
  @TrimString()
  jobTitle?: string;

  @ApiPropertyOptional({
    description: 'Lead acquisition source',
    enum: LeadSource,
    default: LeadSource.OTHER,
  })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({
    description: 'Current lead status',
    enum: LeadStatus,
    default: LeadStatus.NEW,
  })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({
    description: 'Lead score (0 to 100)',
    minimum: 0,
    maximum: 100,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @ApiPropertyOptional({
    description: 'Tags for categorization',
    example: ['enterprise', 'high-priority'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Assigned User ID (Lead Owner)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId()
  ownerId?: string;
}

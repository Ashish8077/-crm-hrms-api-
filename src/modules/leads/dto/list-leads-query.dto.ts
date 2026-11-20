import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { LeadSource } from '../constants/lead-source.constant';
import { LeadStatus } from '../constants/lead-status.constant';

export class ListLeadsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Search across first name, last name, email, phone, or company',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by lead status',
    enum: LeadStatus,
  })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({
    description: 'Filter by lead acquisition source',
    enum: LeadSource,
  })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({
    description: 'Filter by assigned Lead Owner (User ID)',
  })
  @IsOptional()
  @IsMongoId()
  ownerId?: string;

  @ApiPropertyOptional({
    description: 'Minimum lead score',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @ApiPropertyOptional({
    description: 'Maximum lead score',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  maxScore?: number;

  @ApiPropertyOptional({
    description: 'Filter by tag name',
  })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({
    description: 'Sort field (e.g. createdAt, score, firstName, lastName)',
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({
    description: 'Filter leads created on or after this ISO date',
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter leads created on or before this ISO date',
  })
  @IsOptional()
  @IsString()
  endDate?: string;
}

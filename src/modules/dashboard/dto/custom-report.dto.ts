import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ALLOWED_ENTITIES } from '../constants/dashboard-allowlist.constant';

export class CustomReportFilterDto {
  @ApiProperty({ description: 'Field name' })
  @IsString()
  field!: string;

  @ApiProperty({ description: 'Filter operator', enum: ['eq', 'ne', 'in', 'gt', 'lt', 'gte', 'lte'] })
  @IsEnum(['eq', 'ne', 'in', 'gt', 'lt', 'gte', 'lte'])
  operator!: 'eq' | 'ne' | 'in' | 'gt' | 'lt' | 'gte' | 'lte';

  @ApiProperty({ description: 'Filter value' })
  value!: unknown;
}

export class CustomReportDto {
  @ApiProperty({ description: 'Target entity', enum: ALLOWED_ENTITIES, example: 'deals' })
  @IsEnum(ALLOWED_ENTITIES)
  entity!: string;

  @ApiProperty({ description: 'Fields to select/project', example: ['stage', 'amount', 'currency'] })
  @IsArray()
  @IsString({ each: true })
  fields!: string[];

  @ApiPropertyOptional({ description: 'Field to group by', example: 'stage' })
  @IsString()
  @IsOptional()
  groupBy?: string;

  @ApiPropertyOptional({ description: 'Filter start date (ISO 8601)', example: '2026-01-01' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter end date (ISO 8601)', example: '2026-12-31' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Sort field' })
  @IsString()
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({ description: 'Sort direction', enum: ['asc', 'desc'], default: 'desc' })
  @IsEnum(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Row limit (max 1000)', default: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  limit?: number = 100;
}

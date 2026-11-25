import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { ALLOWED_ENTITIES } from '../constants/dashboard-allowlist.constant';

export class ExportQueryDto {
  @ApiProperty({
    description: 'Target entity to export',
    enum: ALLOWED_ENTITIES,
    example: 'leads',
  })
  @IsEnum(ALLOWED_ENTITIES)
  entity!: string;

  @ApiProperty({
    description: 'File export format',
    enum: ['csv', 'xlsx'],
    example: 'csv',
  })
  @IsEnum(['csv', 'xlsx'])
  format!: 'csv' | 'xlsx';

  @ApiPropertyOptional({
    description: 'Filter start date (ISO 8601)',
    example: '2026-01-01',
  })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter end date (ISO 8601)',
    example: '2026-12-31',
  })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated fields to include in export',
    example: 'firstName,lastName,email,phone,status',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown[] => {
    if (Array.isArray(value)) return value as unknown[];
    if (typeof value === 'string')
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return [];
  })
  @IsArray()
  @IsString({ each: true })
  fields?: string[];
}

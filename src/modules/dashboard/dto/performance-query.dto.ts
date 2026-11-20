import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export enum PerformanceGranularity {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  QUARTER = 'quarter',
}

export class PerformanceQueryDto {
  @ApiPropertyOptional({ description: 'Filter start date (ISO 8601)', example: '2026-01-01' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter end date (ISO 8601)', example: '2026-12-31' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Time bucket granularity',
    enum: PerformanceGranularity,
    default: PerformanceGranularity.MONTH,
  })
  @IsEnum(PerformanceGranularity)
  @IsOptional()
  granularity?: PerformanceGranularity = PerformanceGranularity.MONTH;

  @ApiPropertyOptional({ description: 'Currency filter', example: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;
}


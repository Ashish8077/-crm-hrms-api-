import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum LeaderboardSortBy {
  DEALS_WON = 'deals_won',
  REVENUE = 'revenue',
  LEADS_CONVERTED = 'leads_converted',
  ACTIVITIES = 'activities',
}

export class LeaderboardQueryDto {
  @ApiPropertyOptional({ description: 'Filter start date (ISO 8601)', example: '2026-01-01' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter end date (ISO 8601)', example: '2026-12-31' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Ranking metric criteria',
    enum: LeaderboardSortBy,
    default: LeaderboardSortBy.DEALS_WON,
  })
  @IsEnum(LeaderboardSortBy)
  @IsOptional()
  sortBy?: LeaderboardSortBy = LeaderboardSortBy.DEALS_WON;

  @ApiPropertyOptional({ description: 'Limit number of results', default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number = 10;
}


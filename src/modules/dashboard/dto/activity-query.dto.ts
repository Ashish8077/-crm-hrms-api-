import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ActivityQueryDto {
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
    description: 'Filter by activity type',
    example: 'CALL',
  })
  @IsString()
  @IsOptional()
  activityType?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  IsDateString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ActivityOutcome } from '../../../common/schemas/crm-activity.schema';

export class UpdateDealActivityDto {
  @ApiPropertyOptional({ example: 'Updated Demo Notes' })
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiPropertyOptional({
    example: 'Client requested follow-up meeting with VP of Product.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '2026-10-16T15:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  activityDate?: string;

  @ApiPropertyOptional({
    example: '2026-10-16T15:00:00.000Z',
    description: 'Alias for activityDate',
  })
  @IsDateString()
  @IsOptional()
  performedAt?: string;

  @ApiPropertyOptional({ example: 60, description: 'Duration in minutes' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  durationMinutes?: number;

  @ApiPropertyOptional({
    enum: ActivityOutcome,
    example: ActivityOutcome.INTERESTED,
  })
  @Transform(({ value }: { value: unknown }): ActivityOutcome | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'string') {
      const v = value
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_');
      return (v === '' ? undefined : v) as ActivityOutcome | undefined;
    }
    return undefined;
  })
  @IsEnum(ActivityOutcome)
  @IsOptional()
  outcome?: ActivityOutcome;
}

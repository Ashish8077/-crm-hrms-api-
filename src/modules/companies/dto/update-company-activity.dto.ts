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

export class UpdateCompanyActivityDto {
  @ApiPropertyOptional({ example: 'Updated Discovery Call Notes' })
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiPropertyOptional({ example: 'Client requested revised quotation.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '2026-10-15T14:30:00.000Z' })
  @IsDateString()
  @IsOptional()
  activityDate?: string;

  @ApiPropertyOptional({ example: '2026-10-15T14:30:00.000Z', description: 'Alias for activityDate' })
  @IsDateString()
  @IsOptional()
  performedAt?: string;

  @ApiPropertyOptional({ example: 45, description: 'Duration in minutes' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  durationMinutes?: number;

  @ApiPropertyOptional({ enum: ActivityOutcome, example: ActivityOutcome.COMPLETED })
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'string') {
      const v = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
      return v === '' ? undefined : v;
    }
    return value;
  })
  @IsEnum(ActivityOutcome)
  @IsOptional()
  outcome?: ActivityOutcome;
}

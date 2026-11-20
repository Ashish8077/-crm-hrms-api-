import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  IsDateString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  ActivityType,
  ActivityOutcome,
} from '../../../common/schemas/crm-activity.schema';

export class LogCompanyActivityDto {
  @ApiProperty({ enum: ActivityType, example: ActivityType.CALL })
  @IsEnum(ActivityType)
  @IsNotEmpty()
  type!: ActivityType;

  @ApiProperty({ example: 'Initial Discovery Call' })
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @ApiPropertyOptional({
    example: 'Discussed requirements, cloud infra, and pricing.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '2026-10-15T14:30:00.000Z' })
  @IsDateString()
  @IsOptional()
  activityDate?: string;

  @ApiPropertyOptional({
    example: '2026-10-15T14:30:00.000Z',
    description: 'Alias for activityDate',
  })
  @IsDateString()
  @IsOptional()
  performedAt?: string;

  @ApiPropertyOptional({ example: 30, description: 'Duration in minutes' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  durationMinutes?: number;

  @ApiPropertyOptional({
    enum: ActivityOutcome,
    example: ActivityOutcome.INTERESTED,
  })
  @Transform(({ value }: { value: unknown }) => {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'string') {
      const v = value
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_');
      return v === '' ? undefined : v;
    }
    return value;
  })
  @IsEnum(ActivityOutcome)
  @IsOptional()
  outcome?: ActivityOutcome;
}

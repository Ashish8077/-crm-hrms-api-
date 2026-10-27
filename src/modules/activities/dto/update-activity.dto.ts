import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  ActivityOutcome,
  ActivityType,
} from '../../../common/schemas/crm-activity.schema';

export class UpdateActivityDto {
  @ApiPropertyOptional({ enum: ActivityType })
  @IsEnum(ActivityType)
  @IsOptional()
  type?: ActivityType;

  @ApiPropertyOptional({ example: 'Follow-up Call' })
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiPropertyOptional({ example: 'Updated notes from client call' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '2026-11-01T15:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  activityDate?: string;

  @ApiPropertyOptional({ example: 45, minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  durationMinutes?: number;

  @ApiPropertyOptional({ enum: ActivityOutcome })
  @IsEnum(ActivityOutcome)
  @IsOptional()
  outcome?: ActivityOutcome;
}

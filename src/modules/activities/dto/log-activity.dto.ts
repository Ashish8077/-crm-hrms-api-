import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  IsDateString,
} from 'class-validator';
import {
  ActivityEntityType,
  ActivityOutcome,
  ActivityType,
} from '../../../common/schemas/crm-activity.schema';

export class LogActivityDto {
  @ApiProperty({ enum: ActivityEntityType, example: ActivityEntityType.LEAD })
  @IsEnum(ActivityEntityType)
  @IsNotEmpty()
  entityType!: ActivityEntityType;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Target CRM entity ID (Lead, Contact, Company, Deal, or Task)',
  })
  @IsMongoId()
  @IsNotEmpty()
  entityId!: string;

  @ApiProperty({ enum: ActivityType, example: ActivityType.CALL })
  @IsEnum(ActivityType)
  @IsNotEmpty()
  type!: ActivityType;

  @ApiProperty({ example: 'Initial Discovery Call' })
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @ApiPropertyOptional({
    example:
      'Discussed cloud migration timeline and security compliance questions.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '2026-11-01T14:30:00.000Z' })
  @IsDateString()
  @IsOptional()
  activityDate?: string;

  @ApiPropertyOptional({ example: 30, minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  durationMinutes?: number;

  @ApiPropertyOptional({
    enum: ActivityOutcome,
    example: ActivityOutcome.CONNECTED,
  })
  @IsEnum(ActivityOutcome)
  @IsOptional()
  outcome?: ActivityOutcome;
}

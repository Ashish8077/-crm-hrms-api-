import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ActivityOutcome } from '../../../common/schemas/crm-activity.schema';
import { TaskPriority } from '../../tasks/constants/task-priority.constant';

export class RecordActivityOutcomeDto {
  @ApiProperty({ enum: ActivityOutcome, example: ActivityOutcome.CONNECTED })
  @IsEnum(ActivityOutcome)
  @IsNotEmpty()
  outcome!: ActivityOutcome;

  @ApiPropertyOptional({
    example: 'Client requested follow-up proposal with revised terms.',
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Spawn a follow-up task automatically in the same transaction',
  })
  @IsBoolean()
  @IsOptional()
  spawnFollowUpTask?: boolean;

  @ApiPropertyOptional({
    example: 'Follow-up proposal discussion',
    description: 'Title of the follow-up task',
  })
  @IsString()
  @IsOptional()
  followUpTitle?: string;

  @ApiPropertyOptional({
    example: '2026-11-10T17:00:00.000Z',
    description:
      'Due date for the follow-up task (required if spawnFollowUpTask is true)',
  })
  @IsDateString()
  @IsOptional()
  followUpDueDate?: string;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description:
      'Assignee for the follow-up task (defaults to activity author)',
  })
  @IsMongoId()
  @IsOptional()
  followUpAssignedTo?: string;

  @ApiPropertyOptional({
    enum: TaskPriority,
    default: TaskPriority.MEDIUM,
  })
  @IsEnum(TaskPriority)
  @IsOptional()
  followUpPriority?: TaskPriority;
}

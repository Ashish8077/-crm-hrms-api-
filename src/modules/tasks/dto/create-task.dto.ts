import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsMongoId,
  IsDateString,
  IsArray,
} from 'class-validator';
import { TaskPriority } from '../constants/task-priority.constant';
import { TaskRelatedEntityType } from '../schemas/task.schema';

export class CreateTaskDto {
  @ApiProperty({ example: 'Follow up on Q4 Proposal' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({
    example: 'Reach out to Acme Corp about pricing tier discounts.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: TaskPriority, default: TaskPriority.MEDIUM })
  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Assigned user ID',
  })
  @IsMongoId()
  @IsNotEmpty()
  assignedTo!: string;

  @ApiPropertyOptional({ example: '2026-11-01T09:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiProperty({ example: '2026-11-05T17:00:00.000Z' })
  @IsDateString()
  @IsNotEmpty()
  dueDate!: string;

  @ApiPropertyOptional({
    enum: TaskRelatedEntityType,
    example: TaskRelatedEntityType.DEAL,
  })
  @IsEnum(TaskRelatedEntityType)
  @IsOptional()
  relatedToType?: TaskRelatedEntityType;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439012' })
  @IsMongoId()
  @IsOptional()
  relatedToId?: string;

  @ApiPropertyOptional({ example: '2026-11-05T09:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  reminderAt?: string;

  @ApiPropertyOptional({ example: ['proposal', 'q4'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsEnum,
  IsMongoId,
  IsDateString,
  IsIn,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { TaskStatus } from '../constants/task-status.constant';
import { TaskPriority } from '../constants/task-priority.constant';
import { TaskRelatedEntityType } from '../schemas/task.schema';

export const TASK_SORTABLE_FIELDS = [
  'dueDate',
  'priority',
  'status',
  'createdAt',
  'title',
] as const;

export class ListTasksQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search term matching title or description',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: 'Filter by assigned user ID' })
  @IsMongoId()
  @IsOptional()
  assignedTo?: string;

  @ApiPropertyOptional({ description: 'Filter by creator user ID' })
  @IsMongoId()
  @IsOptional()
  createdBy?: string;

  @ApiPropertyOptional({ description: 'Filter by team ID' })
  @IsMongoId()
  @IsOptional()
  teamId?: string;

  @ApiPropertyOptional({ enum: TaskRelatedEntityType })
  @IsEnum(TaskRelatedEntityType)
  @IsOptional()
  relatedToType?: TaskRelatedEntityType;

  @ApiPropertyOptional({ description: 'Filter by CRM related entity ID' })
  @IsMongoId()
  @IsOptional()
  relatedToId?: string;

  @ApiPropertyOptional({ description: 'Filter tasks due on or before date' })
  @IsDateString()
  @IsOptional()
  dueBefore?: string;

  @ApiPropertyOptional({ description: 'Filter tasks due on or after date' })
  @IsDateString()
  @IsOptional()
  dueAfter?: string;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    enum: TASK_SORTABLE_FIELDS,
    default: 'dueDate',
  })
  @IsIn(TASK_SORTABLE_FIELDS)
  @IsOptional()
  sortField?: (typeof TASK_SORTABLE_FIELDS)[number] = 'dueDate';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'asc',
  })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'asc';
}

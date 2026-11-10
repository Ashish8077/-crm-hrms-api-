import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import {
  ActivityEntityType,
  ActivityOutcome,
  ActivityType,
} from '../../../common/schemas/crm-activity.schema';
import { ACTIVITY_SORTABLE_FIELDS } from '../activities.constants';

export class ListActivitiesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search term matching subject or description',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: ActivityEntityType })
  @IsEnum(ActivityEntityType)
  @IsOptional()
  entityType?: ActivityEntityType;

  @ApiPropertyOptional({ description: 'Target entity ID' })
  @IsMongoId()
  @IsOptional()
  entityId?: string;

  @ApiPropertyOptional({ enum: ActivityType })
  @IsEnum(ActivityType)
  @IsOptional()
  type?: ActivityType;

  @ApiPropertyOptional({ enum: ActivityOutcome })
  @IsEnum(ActivityOutcome)
  @IsOptional()
  outcome?: ActivityOutcome;

  @ApiPropertyOptional({
    description: 'User ID of person who performed activity',
  })
  @IsMongoId()
  @IsOptional()
  performedBy?: string;

  @ApiPropertyOptional({ description: 'Filter activities on or after date' })
  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filter activities on or before date' })
  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    enum: ACTIVITY_SORTABLE_FIELDS,
    default: 'activityDate',
  })
  @IsIn(ACTIVITY_SORTABLE_FIELDS)
  @IsOptional()
  sortField?: (typeof ACTIVITY_SORTABLE_FIELDS)[number] = 'activityDate';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsEnum,
  IsMongoId,
  IsIn,
  IsNumber,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { DealStage } from '../constants/deal-stage.constant';
import { DealStatus } from '../constants/deal-status.constant';
import { DealPriority } from '../constants/deal.constant';

export const DEAL_SORTABLE_FIELDS = [
  'createdAt',
  'title',
  'amount',
  'stage',
  'status',
  'probability',
  'expectedCloseDate',
  'actualCloseDate',
] as const;

export class ListDealsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search term matching title or description',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Pipeline identifier' })
  @IsString()
  @IsOptional()
  pipeline?: string;

  @ApiPropertyOptional({ enum: DealStage })
  @IsEnum(DealStage)
  @IsOptional()
  stage?: DealStage;

  @ApiPropertyOptional({ enum: DealStatus })
  @IsEnum(DealStatus)
  @IsOptional()
  status?: DealStatus;

  @ApiPropertyOptional({ description: 'Filter by owner user ID' })
  @IsMongoId()
  @IsOptional()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Filter by company ID' })
  @IsMongoId()
  @IsOptional()
  companyId?: string;

  @ApiPropertyOptional({ description: 'Filter by contact ID' })
  @IsMongoId()
  @IsOptional()
  contactId?: string;

  @ApiPropertyOptional({ description: 'Filter by tag' })
  @IsString()
  @IsOptional()
  tag?: string;

  @ApiPropertyOptional({ enum: DealPriority })
  @IsEnum(DealPriority)
  @IsOptional()
  priority?: DealPriority;

  @ApiPropertyOptional({ description: 'Filter by currency code' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ description: 'Minimum deal amount' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  minAmount?: number;

  @ApiPropertyOptional({ description: 'Maximum deal amount' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxAmount?: number;

  @ApiPropertyOptional({ description: 'Filter by expectedCloseDate start' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter by expectedCloseDate end' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ enum: DEAL_SORTABLE_FIELDS, default: 'createdAt' })
  @IsIn(DEAL_SORTABLE_FIELDS)
  @IsOptional()
  sortBy?: (typeof DEAL_SORTABLE_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}

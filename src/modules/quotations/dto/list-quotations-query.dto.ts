import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import {
  QuotationApprovalStatus,
  QuotationStatus,
} from '../constants/quotation-status.constant';

export class ListQuotationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by Company ID' })
  @IsOptional()
  @IsMongoId()
  companyId?: string;

  @ApiPropertyOptional({ description: 'Filter by commercial status', enum: QuotationStatus })
  @IsOptional()
  @IsEnum(QuotationStatus)
  status?: QuotationStatus;

  @ApiPropertyOptional({ description: 'Filter by approval status', enum: QuotationApprovalStatus })
  @IsOptional()
  @IsEnum(QuotationApprovalStatus)
  approvalStatus?: QuotationApprovalStatus;

  @ApiPropertyOptional({ description: 'Filter by Contact ID' })
  @IsOptional()
  @IsMongoId()
  contactId?: string;

  @ApiPropertyOptional({ description: 'Filter by Deal ID' })
  @IsOptional()
  @IsMongoId()
  dealId?: string;

  @ApiPropertyOptional({ description: 'Filter by Lead ID' })
  @IsOptional()
  @IsMongoId()
  leadId?: string;

  @ApiPropertyOptional({ description: 'Filter by Owner (User) ID' })
  @IsOptional()
  @IsMongoId()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Filter only latest revisions (default: true)', default: true })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isLatestRevision?: boolean = true;

  @ApiPropertyOptional({ description: 'Search term by quoteNumber, notes, terms' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter quotes created on or after (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter quotes created on or before (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Sort field' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ description: 'Sort order: asc or desc' })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}

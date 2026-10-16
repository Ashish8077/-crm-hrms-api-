import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsMongoId, IsIn } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { CompanyIndustry } from '../constants/company-industry.constant';
import { CompanyType } from '../constants/company-type.constant';
import { CompanyStatus } from '../constants/company-status.constant';

export const COMPANY_SORTABLE_FIELDS = [
  'createdAt',
  'name',
  'annualRevenue',
  'status',
  'industry',
] as const;

export class ListCompaniesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search term across name, domain, email, and phone' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: CompanyStatus })
  @IsEnum(CompanyStatus)
  @IsOptional()
  status?: CompanyStatus;

  @ApiPropertyOptional({ enum: CompanyIndustry })
  @IsEnum(CompanyIndustry)
  @IsOptional()
  industry?: CompanyIndustry;

  @ApiPropertyOptional({ enum: CompanyType })
  @IsEnum(CompanyType)
  @IsOptional()
  type?: CompanyType;

  @ApiPropertyOptional({ description: 'Filter by account manager user ID' })
  @IsMongoId()
  @IsOptional()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Filter by specific tag' })
  @IsString()
  @IsOptional()
  tag?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: COMPANY_SORTABLE_FIELDS,
    default: 'createdAt',
  })
  @IsIn(COMPANY_SORTABLE_FIELDS)
  @IsOptional()
  sortBy?: (typeof COMPANY_SORTABLE_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

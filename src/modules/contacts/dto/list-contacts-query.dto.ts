import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsMongoId, IsIn } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { ContactStatus } from '../constants/contact-status.constant';
import { DecisionRole } from '../constants/decision-role.constant';

export const CONTACT_SORTABLE_FIELDS = [
  'createdAt',
  'firstName',
  'lastName',
  'email',
  'status',
] as const;

export class ListContactsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search term across name, email, phone, and jobTitle',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by linked company ID' })
  @IsMongoId()
  @IsOptional()
  companyId?: string;

  @ApiPropertyOptional({ description: 'Filter by account manager user ID' })
  @IsMongoId()
  @IsOptional()
  ownerId?: string;

  @ApiPropertyOptional({ enum: ContactStatus })
  @IsEnum(ContactStatus)
  @IsOptional()
  status?: ContactStatus;

  @ApiPropertyOptional({ enum: DecisionRole })
  @IsEnum(DecisionRole)
  @IsOptional()
  decisionRole?: DecisionRole;

  @ApiPropertyOptional({ description: 'Filter by specific tag' })
  @IsString()
  @IsOptional()
  tag?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: CONTACT_SORTABLE_FIELDS,
    default: 'createdAt',
  })
  @IsIn(CONTACT_SORTABLE_FIELDS)
  @IsOptional()
  sortBy?: (typeof CONTACT_SORTABLE_FIELDS)[number] = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

import { IsOptional, IsBoolean, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';

export class GetRolesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by system role status',
    example: false,
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isSystemRole?: boolean;

  @ApiPropertyOptional({
    description: 'Search term for name or key (case-insensitive)',
    example: 'hr',
  })
  @IsOptional()
  @IsString()
  search?: string;
}

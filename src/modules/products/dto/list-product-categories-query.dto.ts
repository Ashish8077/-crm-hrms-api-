import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsMongoId, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';

export class ListProductCategoriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value as boolean | undefined;
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by parent category ID',
    example: '6ae049328c03f23ab96ce05c',
  })
  @IsMongoId()
  @IsOptional()
  parentCategoryId?: string;

  @ApiPropertyOptional({
    description:
      'Return category hierarchy tree structure instead of flat list',
    example: true,
  })
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  tree?: boolean;

  @ApiPropertyOptional({
    description: 'Search by category name or description',
    example: 'SaaS',
  })
  @IsString()
  @IsOptional()
  search?: string;
}

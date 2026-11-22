import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';

export class ListWeeklyOffQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by branch ID. Pass a valid branch ID, or "null"/"company" for company-wide default configurations.',
    example: '60d5ecb8b5c9c32b8c8d4e11',
  })
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by active status. If omitted, returns all configurations regardless of active status.',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;
}

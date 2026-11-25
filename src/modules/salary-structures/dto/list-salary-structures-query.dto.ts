import { IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import {
  SalaryStructureBasis,
  SALARY_STRUCTURE_SORTABLE_FIELDS,
} from '../constants/salary-structure.constant';

export class ListSalaryStructuresQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search by structure name or code (case-insensitive)',
    example: 'Engineering',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by salary basis',
    enum: SalaryStructureBasis,
    example: SalaryStructureBasis.CTC,
  })
  @IsOptional()
  @IsEnum(SalaryStructureBasis)
  salaryBasis?: SalaryStructureBasis;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    enum: SALARY_STRUCTURE_SORTABLE_FIELDS,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(SALARY_STRUCTURE_SORTABLE_FIELDS)
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

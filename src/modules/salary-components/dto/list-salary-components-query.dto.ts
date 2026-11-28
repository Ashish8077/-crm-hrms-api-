import { IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import {
  SALARY_COMPONENT_SORTABLE_FIELDS,
  SalaryComponentCalculationType,
  SalaryComponentType,
} from '../constants/salary-component.constant';

export class ListSalaryComponentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search by component name or code (case-insensitive)',
    example: 'Basic',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by component type',
    enum: SalaryComponentType,
    example: SalaryComponentType.EARNING,
  })
  @IsOptional()
  @IsEnum(SalaryComponentType)
  type?: SalaryComponentType;

  @ApiPropertyOptional({
    description: 'Filter by calculation type',
    enum: SalaryComponentCalculationType,
    example: SalaryComponentCalculationType.FIXED,
  })
  @IsOptional()
  @IsEnum(SalaryComponentCalculationType)
  calculationType?: SalaryComponentCalculationType;

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
    description: 'Filter by statutory compliance flag',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  isStatutory?: boolean;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    enum: SALARY_COMPONENT_SORTABLE_FIELDS,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(SALARY_COMPONENT_SORTABLE_FIELDS)
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

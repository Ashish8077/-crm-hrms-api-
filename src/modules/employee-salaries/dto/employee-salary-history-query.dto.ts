import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { EMPLOYEE_SALARY_SORTABLE_FIELDS } from '../constants/employee-salary.constant';

export class EmployeeSalaryHistoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Field to sort history records by',
    enum: EMPLOYEE_SALARY_SORTABLE_FIELDS,
    default: 'effectiveFrom',
  })
  @IsOptional()
  @IsIn(EMPLOYEE_SALARY_SORTABLE_FIELDS)
  sortBy?: string = 'effectiveFrom';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

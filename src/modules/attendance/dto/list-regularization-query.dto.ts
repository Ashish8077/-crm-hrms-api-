import { IsEnum, IsMongoId, IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { RegularizationStatus } from '../constants/attendance.constant';

export class ListRegularizationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by Employee ID' })
  @IsOptional()
  @IsMongoId()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'Filter by regularization status',
    enum: RegularizationStatus,
  })
  @IsOptional()
  @IsEnum(RegularizationStatus)
  status?: RegularizationStatus;

  @ApiPropertyOptional({
    description: 'Filter from attendance date (YYYY-MM-DD)',
    example: '2026-10-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be in YYYY-MM-DD format',
  })
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter to attendance date (YYYY-MM-DD)',
    example: '2026-10-31',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate must be in YYYY-MM-DD format',
  })
  endDate?: string;
}

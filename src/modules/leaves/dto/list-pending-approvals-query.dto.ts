import {
  IsInt,
  IsMongoId,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import { IsDateBeforeOrEqual } from '../../../common/validation/decorators/is-date-before-or-equal.decorator';

export class ListPendingApprovalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter pending approvals by specific direct report employee ID',
    example: '60d5ecb8b5c9c32b8c8d4e11',
  })
  @IsOptional()
  @IsMongoId()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'Filter pending approvals by leave type ID',
    example: '60d5ecb8b5c9c32b8c8d4e22',
  })
  @IsOptional()
  @IsMongoId()
  leaveTypeId?: string;

  @ApiPropertyOptional({
    description:
      'Start date range filter (YYYY-MM-DD) for overlapping leave window',
    example: '2026-10-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be in YYYY-MM-DD format',
  })
  @IsDateBeforeOrEqual('endDate', {
    message: 'startDate must not be later than endDate',
  })
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'End date range filter (YYYY-MM-DD) for overlapping leave window',
    example: '2026-10-31',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate must be in YYYY-MM-DD format',
  })
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by calendar year',
    example: 2026,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

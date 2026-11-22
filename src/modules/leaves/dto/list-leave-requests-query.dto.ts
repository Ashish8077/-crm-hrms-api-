import {
  IsEnum,
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
import { LeaveRequestStatus } from '../constants/leaves.constant';
import { IsDateBeforeOrEqual } from '../../../common/validation/decorators/is-date-before-or-equal.decorator';

export class ListLeaveRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by specific Employee ID (Managers/HR)',
    example: '60d5ecb8b5c9c32b8c8d4e11',
  })
  @IsOptional()
  @IsMongoId()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'Filter by request status',
    enum: LeaveRequestStatus,
  })
  @IsOptional()
  @IsEnum(LeaveRequestStatus)
  status?: LeaveRequestStatus;

  @ApiPropertyOptional({
    description: 'Filter by specific leave type ID',
    example: '60d5ecb8b5c9c32b8c8d4e22',
  })
  @IsOptional()
  @IsMongoId()
  leaveTypeId?: string;

  @ApiPropertyOptional({
    description: 'Start date range filter (YYYY-MM-DD)',
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
    description: 'End date range filter (YYYY-MM-DD)',
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

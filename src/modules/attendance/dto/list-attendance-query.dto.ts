import {
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsOptional,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/dto/pagination-query.dto';
import {
  AttendanceStatus,
  AttendanceType,
} from '../constants/attendance.constant';

export class ListAttendanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by specific Employee ID' })
  @IsOptional()
  @IsMongoId()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Filter by Department ID' })
  @IsOptional()
  @IsMongoId()
  departmentId?: string;

  @ApiPropertyOptional({
    description: 'Start date filter (YYYY-MM-DD)',
    example: '2026-10-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be in YYYY-MM-DD format',
  })
  startDate?: string;

  @ApiPropertyOptional({
    description: 'End date filter (YYYY-MM-DD)',
    example: '2026-10-31',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate must be in YYYY-MM-DD format',
  })
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by attendance status',
    enum: AttendanceStatus,
  })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @ApiPropertyOptional({
    description: 'Filter by attendance type',
    enum: AttendanceType,
  })
  @IsOptional()
  @IsEnum(AttendanceType)
  attendanceType?: AttendanceType;

  @ApiPropertyOptional({ description: 'Filter only late attendance records' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isLate?: boolean;
}

import {
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  AttendanceSource,
  AttendanceType,
} from '../constants/attendance.constant';

export class GeoLocationDto {
  @ApiPropertyOptional({ description: 'Latitude coordinate', example: 12.9716 })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({
    description: 'Longitude coordinate',
    example: 77.5946,
  })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ description: 'Readable address or landmark' })
  @IsOptional()
  @IsString()
  address?: string;
}

export class CheckInDto {
  @ApiPropertyOptional({
    description: 'Attendance type (REGULAR, WORK_FROM_HOME, ON_DUTY)',
    enum: AttendanceType,
    default: AttendanceType.REGULAR,
  })
  @IsOptional()
  @IsEnum(AttendanceType)
  attendanceType?: AttendanceType;

  @ApiPropertyOptional({
    description: 'Check-in source (WEB, MOBILE, BIOMETRIC)',
    enum: AttendanceSource,
    default: AttendanceSource.WEB,
  })
  @IsOptional()
  @IsEnum(AttendanceSource)
  source?: AttendanceSource;

  @ApiPropertyOptional({
    description:
      'Explicit Shift ID (optional; defaults to assigned or default shift)',
  })
  @IsOptional()
  @IsMongoId()
  shiftId?: string;

  @ApiPropertyOptional({ description: 'Geographic location metadata' })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoLocationDto)
  location?: GeoLocationDto;

  @ApiPropertyOptional({ description: 'Notes or remarks for check-in' })
  @IsOptional()
  @IsString()
  notes?: string;
}

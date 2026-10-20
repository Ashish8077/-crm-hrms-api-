import { IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceSource } from '../constants/attendance.constant';
import { GeoLocationDto } from './check-in.dto';

export class CheckOutDto {
  @ApiPropertyOptional({
    description: 'Check-out source (WEB, MOBILE, BIOMETRIC)',
    enum: AttendanceSource,
    default: AttendanceSource.WEB,
  })
  @IsOptional()
  @IsEnum(AttendanceSource)
  source?: AttendanceSource;

  @ApiPropertyOptional({ description: 'Geographic location metadata' })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoLocationDto)
  location?: GeoLocationDto;

  @ApiPropertyOptional({ description: 'Notes or remarks for check-out' })
  @IsOptional()
  @IsString()
  notes?: string;
}

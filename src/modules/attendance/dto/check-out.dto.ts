import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceSource } from '../constants/attendance.constant';
import { DeviceInfoDto, GeoLocationDto } from './check-in.dto';

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

  @ApiPropertyOptional({
    description:
      'Notes or remarks for check-out (sanitized, max 200 characters)',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }): string | undefined =>
    typeof value === 'string'
      ? value.replace(/<[^>]*>/g, '').trim()
      : undefined,
  )
  notes?: string;

  @ApiPropertyOptional({
    description: 'Device information metadata',
    type: () => DeviceInfoDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  deviceInfo?: DeviceInfoDto;
}

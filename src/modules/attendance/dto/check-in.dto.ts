import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceSource, WorkMode } from '../constants/attendance.constant';

export { WorkMode };

export class GeoLocationDto {
  @ApiPropertyOptional({
    description: 'Latitude coordinate (-90 to 90)',
    example: 12.9716,
    minimum: -90,
    maximum: 90,
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({
    description: 'Longitude coordinate (-180 to 180)',
    example: 77.5946,
    minimum: -180,
    maximum: 180,
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({
    description:
      'GPS accuracy in meters reported by device (accuracy > 100m rejected to prevent cell-tower jumps)',
    example: 15,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracyMeters?: number;

  @ApiPropertyOptional({
    description:
      'Untrusted client-reported address hint (server verifies strictly via GPS geofence)',
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
  address?: string;
}

export class DeviceInfoDto {
  @ApiPropertyOptional({
    description: 'Unique device identifier (e.g. UUID, Android ID, IDFV)',
    example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceId?: string;

  @ApiPropertyOptional({
    description:
      'Device model or name (e.g. iPhone 15 Pro, Samsung Galaxy S24)',
    example: 'iPhone 15 Pro',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;

  @ApiPropertyOptional({
    description:
      'Operating system platform (e.g. iOS, Android, macOS, Windows)',
    example: 'iOS',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  platform?: string;

  @ApiPropertyOptional({
    description: 'Operating system version (e.g. 17.4.1, 14.0)',
    example: '17.4.1',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  osVersion?: string;

  @ApiPropertyOptional({
    description: 'Client application version (e.g. 1.2.0)',
    example: '1.2.0',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;
}

export class CheckInDto {
  @ApiPropertyOptional({
    description: 'Work mode (OFFICE, WORK_FROM_HOME, ON_DUTY)',
    enum: WorkMode,
    default: WorkMode.OFFICE,
  })
  @IsOptional()
  @IsEnum(WorkMode)
  @Transform(
    ({
      value,
      obj,
    }: {
      value?: unknown;
      obj?: { attendanceType?: string; workMode?: unknown };
    }): unknown => {
      const raw = value ?? obj?.attendanceType;
      if (raw === 'REGULAR') {
        return WorkMode.OFFICE;
      }
      return raw;
    },
  )
  workMode?: WorkMode;

  @ApiPropertyOptional({
    description: 'Legacy alias for workMode (deprecated; use workMode)',
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  attendanceType?: string;

  @ApiPropertyOptional({
    description:
      'Client-provided shift ID hint (ignored during self-punch; resolved strictly by server)',
  })
  @IsOptional()
  @IsString()
  shiftId?: string;

  @ApiPropertyOptional({
    description: 'Check-in source (WEB, MOBILE, BIOMETRIC)',
    enum: AttendanceSource,
    default: AttendanceSource.WEB,
  })
  @IsOptional()
  @IsEnum(AttendanceSource)
  source?: AttendanceSource;

  @ApiPropertyOptional({ description: 'Geographic location coordinates' })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoLocationDto)
  location?: GeoLocationDto;

  @ApiPropertyOptional({
    description:
      'Notes or remarks for check-in (sanitized, max 200 characters)',
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

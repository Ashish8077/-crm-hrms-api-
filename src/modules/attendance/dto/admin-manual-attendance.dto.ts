import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkMode } from '../constants/attendance.constant';

export class AdminManualAttendanceDto {
  @ApiProperty({ description: 'Target employee ID' })
  @IsNotEmpty()
  @IsMongoId()
  employeeId!: string;

  @ApiProperty({
    description: 'Attendance date (YYYY-MM-DD)',
    example: '2026-10-23',
  })
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'attendanceDate must be in YYYY-MM-DD format',
  })
  attendanceDate!: string;

  @ApiProperty({
    description:
      'Check-in timestamp. Supported: UTC ISO (2026-10-23T03:30:00.000Z for 9:00 AM IST), ISO with local offset (2026-10-23T09:00:00+05:30), local naive ISO (2026-10-23T09:00:00), or time (09:00)',
    example: '2026-10-23T03:30:00.000Z',
  })
  @IsNotEmpty()
  @IsString()
  checkInTime!: string;

  @ApiPropertyOptional({
    description:
      'Check-out timestamp. Supported: UTC ISO (2026-10-23T12:30:00.000Z for 6:00 PM IST), ISO with local offset (2026-10-23T18:00:00+05:30), local naive ISO (2026-10-23T18:00:00), or time (18:00)',
    example: '2026-10-23T12:30:00.000Z',
  })
  @IsOptional()
  @IsString()
  checkOutTime?: string;

  @ApiPropertyOptional({
    description:
      'Explicit shift override (Only accepted for Admin / HR manual entry; validated for existence and active state)',
  })
  @IsOptional()
  @IsMongoId()
  shiftId?: string;

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
      'Notes or remarks for manual entry (sanitized, max 200 characters)',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }): string | undefined =>
    typeof value === 'string'
      ? value
          .replace(/<[^>]*>/g, '')
          .trim()
          .slice(0, 200)
      : undefined,
  )
  notes?: string;
}

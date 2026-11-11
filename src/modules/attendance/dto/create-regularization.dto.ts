import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RegularizationType } from '../constants/attendance.constant';

export class CreateRegularizationDto {
  @ApiProperty({
    description: 'Attendance date being regularized (YYYY-MM-DD)',
    example: '2026-10-15',
  })
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'attendanceDate must be in YYYY-MM-DD format',
  })
  attendanceDate!: string;

  @ApiPropertyOptional({
    description: 'Type of regularization',
    enum: RegularizationType,
    example: RegularizationType.TIME_CORRECTION,
  })
  @IsOptional()
  @IsEnum(RegularizationType)
  type?: RegularizationType;

  @ApiPropertyOptional({
    description:
      'Requested check-in time or timestamp. Recommended: Simple time string (e.g. "09:00" or "09:00 AM") or local naive ISO ("2026-10-15T09:00:00"). If UTC ISO with Z is passed ("2026-10-15T03:30:00.000Z"), it must be the true UTC timestamp converted from local branch time to prevent late arrival deductions.',
    example: '09:00',
  })
  @IsOptional()
  @IsString()
  requestedCheckInTime?: string | null;

  @ApiPropertyOptional({
    description:
      'Requested check-out time or timestamp. Recommended: Simple time string (e.g. "18:00" or "06:00 PM") or local naive ISO ("2026-10-15T18:00:00"). If UTC ISO with Z is passed ("2026-10-15T12:30:00.000Z"), it must be the true UTC timestamp converted from local branch time.',
    example: '18:00',
  })
  @IsOptional()
  @IsString()
  requestedCheckOutTime?: string | null;

  @ApiProperty({
    description: 'Reason for requesting attendance regularization',
    example: 'Biometric device offline during morning check-in',
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(5, { message: 'reason must be at least 5 characters long' })
  reason!: string;

  @ApiPropertyOptional({
    description:
      'Associated attendance record ID if regularizing an existing session',
  })
  @IsOptional()
  @IsMongoId()
  attendanceId?: string;
}

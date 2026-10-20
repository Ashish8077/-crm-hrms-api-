import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import { ATTENDANCE_CONSTANTS } from '../constants/attendance.constant';

export class CreateShiftDto {
  @ApiProperty({ description: 'Shift display name', example: 'General Shift' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MinLength(ATTENDANCE_CONSTANTS.SHIFT_NAME_MIN_LENGTH)
  @MaxLength(ATTENDANCE_CONSTANTS.SHIFT_NAME_MAX_LENGTH)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9 ._()-]*$/, {
    message:
      'name may contain only alphanumeric characters, spaces, dots, underscores, hyphens, and parentheses',
  })
  name!: string;

  @ApiProperty({
    description: 'Unique shift code',
    example: 'GEN',
  })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MinLength(ATTENDANCE_CONSTANTS.SHIFT_CODE_MIN_LENGTH)
  @MaxLength(ATTENDANCE_CONSTANTS.SHIFT_CODE_MAX_LENGTH)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code may contain only letters, numbers, underscores, and hyphens',
  })
  code!: string;

  @ApiProperty({
    description: 'Shift start time (24-hour HH:mm)',
    example: '09:00',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime must be in 24-hour HH:mm format',
  })
  startTime!: string;

  @ApiProperty({
    description: 'Shift end time (24-hour HH:mm)',
    example: '18:00',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'endTime must be in 24-hour HH:mm format',
  })
  endTime!: string;

  @ApiPropertyOptional({
    description: 'Flag indicating whether shift crosses midnight into next day',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isOvernight?: boolean = false;

  @ApiPropertyOptional({
    description: 'Grace period in minutes before employee is marked late',
    default: ATTENDANCE_CONSTANTS.DEFAULT_GRACE_PERIOD_MINUTES,
  })
  @IsOptional()
  @IsInt()
  @Min(ATTENDANCE_CONSTANTS.MIN_GRACE_PERIOD_MINUTES)
  @Max(ATTENDANCE_CONSTANTS.MAX_GRACE_PERIOD_MINUTES)
  gracePeriodMinutes?: number =
    ATTENDANCE_CONSTANTS.DEFAULT_GRACE_PERIOD_MINUTES;

  @ApiPropertyOptional({
    description: 'Default expected break duration in minutes',
    default: ATTENDANCE_CONSTANTS.DEFAULT_BREAK_DURATION_MINUTES,
  })
  @IsOptional()
  @IsInt()
  @Min(ATTENDANCE_CONSTANTS.MIN_BREAK_DURATION_MINUTES)
  @Max(ATTENDANCE_CONSTANTS.MAX_BREAK_DURATION_MINUTES)
  breakDurationMinutes?: number =
    ATTENDANCE_CONSTANTS.DEFAULT_BREAK_DURATION_MINUTES;

  @ApiPropertyOptional({
    description:
      'Minimum work minutes required to qualify as Full Day (PRESENT)',
    default: ATTENDANCE_CONSTANTS.DEFAULT_FULL_DAY_MINUTES,
  })
  @IsOptional()
  @IsInt()
  @Min(ATTENDANCE_CONSTANTS.MIN_FULL_DAY_MINUTES)
  @Max(ATTENDANCE_CONSTANTS.MAX_FULL_DAY_MINUTES)
  minWorkMinutesForFullDay?: number =
    ATTENDANCE_CONSTANTS.DEFAULT_FULL_DAY_MINUTES;

  @ApiPropertyOptional({
    description:
      'Minimum work minutes required to qualify as Half Day (HALF_DAY)',
    default: ATTENDANCE_CONSTANTS.DEFAULT_HALF_DAY_MINUTES,
  })
  @IsOptional()
  @IsInt()
  @Min(ATTENDANCE_CONSTANTS.MIN_HALF_DAY_MINUTES)
  @Max(ATTENDANCE_CONSTANTS.MAX_HALF_DAY_MINUTES)
  minWorkMinutesForHalfDay?: number =
    ATTENDANCE_CONSTANTS.DEFAULT_HALF_DAY_MINUTES;

  @ApiPropertyOptional({
    description: 'Work minutes threshold after which overtime is calculated',
    default: ATTENDANCE_CONSTANTS.DEFAULT_OVERTIME_THRESHOLD_MINUTES,
  })
  @IsOptional()
  @IsInt()
  @Min(ATTENDANCE_CONSTANTS.MIN_OVERTIME_THRESHOLD_MINUTES)
  @Max(ATTENDANCE_CONSTANTS.MAX_OVERTIME_THRESHOLD_MINUTES)
  overtimeThresholdMinutes?: number =
    ATTENDANCE_CONSTANTS.DEFAULT_OVERTIME_THRESHOLD_MINUTES;

  @ApiPropertyOptional({
    description: 'Set this shift as organization default',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean = false;

  @ApiPropertyOptional({
    description: 'Whether shift is active for scheduling',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

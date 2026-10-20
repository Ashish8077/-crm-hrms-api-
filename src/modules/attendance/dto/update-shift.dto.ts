import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import { ATTENDANCE_CONSTANTS } from '../constants/attendance.constant';

export class UpdateShiftDto {
  @ApiPropertyOptional({ description: 'Shift display name' })
  @IsOptional()
  @TrimString()
  @IsString()
  @MinLength(ATTENDANCE_CONSTANTS.SHIFT_NAME_MIN_LENGTH)
  @MaxLength(ATTENDANCE_CONSTANTS.SHIFT_NAME_MAX_LENGTH)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9 ._()-]*$/, {
    message:
      'name may contain only alphanumeric characters, spaces, dots, underscores, hyphens, and parentheses',
  })
  name?: string;

  @ApiPropertyOptional({ description: 'Unique shift code' })
  @IsOptional()
  @TrimString()
  @IsString()
  @MinLength(ATTENDANCE_CONSTANTS.SHIFT_CODE_MIN_LENGTH)
  @MaxLength(ATTENDANCE_CONSTANTS.SHIFT_CODE_MAX_LENGTH)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code may contain only letters, numbers, underscores, and hyphens',
  })
  code?: string;

  @ApiPropertyOptional({ description: 'Shift start time (24-hour HH:mm)' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime must be in 24-hour HH:mm format',
  })
  startTime?: string;

  @ApiPropertyOptional({ description: 'Shift end time (24-hour HH:mm)' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'endTime must be in 24-hour HH:mm format',
  })
  endTime?: string;

  @ApiPropertyOptional({ description: 'Flag for overnight shift' })
  @IsOptional()
  @IsBoolean()
  isOvernight?: boolean;

  @ApiPropertyOptional({ description: 'Grace period in minutes' })
  @IsOptional()
  @IsInt()
  @Min(ATTENDANCE_CONSTANTS.MIN_GRACE_PERIOD_MINUTES)
  @Max(ATTENDANCE_CONSTANTS.MAX_GRACE_PERIOD_MINUTES)
  gracePeriodMinutes?: number;

  @ApiPropertyOptional({ description: 'Default break duration in minutes' })
  @IsOptional()
  @IsInt()
  @Min(ATTENDANCE_CONSTANTS.MIN_BREAK_DURATION_MINUTES)
  @Max(ATTENDANCE_CONSTANTS.MAX_BREAK_DURATION_MINUTES)
  breakDurationMinutes?: number;

  @ApiPropertyOptional({ description: 'Min work minutes for full day' })
  @IsOptional()
  @IsInt()
  @Min(ATTENDANCE_CONSTANTS.MIN_FULL_DAY_MINUTES)
  @Max(ATTENDANCE_CONSTANTS.MAX_FULL_DAY_MINUTES)
  minWorkMinutesForFullDay?: number;

  @ApiPropertyOptional({ description: 'Min work minutes for half day' })
  @IsOptional()
  @IsInt()
  @Min(ATTENDANCE_CONSTANTS.MIN_HALF_DAY_MINUTES)
  @Max(ATTENDANCE_CONSTANTS.MAX_HALF_DAY_MINUTES)
  minWorkMinutesForHalfDay?: number;

  @ApiPropertyOptional({ description: 'Overtime threshold in minutes' })
  @IsOptional()
  @IsInt()
  @Min(ATTENDANCE_CONSTANTS.MIN_OVERTIME_THRESHOLD_MINUTES)
  @Max(ATTENDANCE_CONSTANTS.MAX_OVERTIME_THRESHOLD_MINUTES)
  overtimeThresholdMinutes?: number;

  @ApiPropertyOptional({ description: 'Default shift flag' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

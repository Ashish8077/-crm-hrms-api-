import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import { IsValidCalendarDate } from '../../../common/validation/decorators/is-valid-calendar-date.decorator';
import { IsDateBeforeOrEqual } from '../../../common/validation/decorators/is-date-before-or-equal.decorator';
import { WEEKLY_OFF_CONSTANTS } from '../constants/weekly-off.constant';
import { WeeklyOffDayDto } from './weekly-off-day.dto';

export class UpdateWeeklyOffConfigDto {
  @ApiPropertyOptional({
    description: 'Updated name of the weekly off configuration',
    example: 'Corporate Standard Weekly Off (Updated)',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MinLength(WEEKLY_OFF_CONSTANTS.NAME_MIN_LENGTH)
  @MaxLength(WEEKLY_OFF_CONSTANTS.NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description: 'Updated description of the policy',
    example: 'All Sundays and 1st/3rd Saturdays are off.',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(WEEKLY_OFF_CONSTANTS.DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    description: 'Updated list of weekly off rules for days of the week',
    type: [WeeklyOffDayDto],
  })
  @IsOptional()
  @IsArray({ message: 'days must be an array.' })
  @ArrayMinSize(1, {
    message: 'At least one weekly off day rule must be specified',
  })
  @ArrayUnique((o: WeeklyOffDayDto) => o.dayOfWeek, {
    message:
      'Duplicate weekday entries are not allowed. Combine occurrences into a single entry.',
  })
  @ValidateNested({ each: true })
  @Type(() => WeeklyOffDayDto)
  days?: WeeklyOffDayDto[];

  @ApiPropertyOptional({
    description: 'Effective start date (YYYY-MM-DD)',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsString()
  @IsValidCalendarDate()
  @IsDateBeforeOrEqual('effectiveTo')
  effectiveFrom?: string;

  @ApiPropertyOptional({
    description:
      'Effective end date (YYYY-MM-DD, must be >= effectiveFrom); set null for ongoing/open-ended',
    example: '2026-12-31',
    nullable: true,
  })
  @IsOptional()
  @IsValidCalendarDate()
  effectiveTo?: string | null;

  @ApiPropertyOptional({
    description: 'Whether the configuration is active',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

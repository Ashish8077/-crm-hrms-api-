import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WeeklyOffDayDto {
  @ApiProperty({
    description:
      'Day of week: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday',
    example: 0,
    minimum: 0,
    maximum: 6,
  })
  @IsInt({ message: 'dayOfWeek must be an integer.' })
  @Min(0, { message: 'dayOfWeek must be between 0 and 6.' })
  @Max(6, { message: 'dayOfWeek must be between 0 and 6.' })
  dayOfWeek!: number;

  @ApiPropertyOptional({
    description:
      'Occurrences in the month to mark as off (1=1st, 2=2nd, 3=3rd, 4=4th, 5=5th). Omit or pass all [1, 2, 3, 4, 5] for every occurrence.',
    example: [1, 2, 3, 4, 5],
    type: [Number],
  })
  @IsOptional()
  @IsArray({ message: 'occurrences must be an array.' })
  @ArrayMinSize(1, { message: 'At least one occurrence is required' })
  @ArrayMaxSize(5, { message: 'occurrences cannot exceed 5 entries.' })
  @IsInt({ each: true, message: 'Occurrence must be an integer.' })
  @Min(1, { each: true, message: 'Occurrence must be between 1 and 5.' })
  @Max(5, { each: true, message: 'Occurrence must be between 1 and 5.' })
  occurrences?: number[];
}

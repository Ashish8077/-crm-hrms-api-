import { IsMongoId, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttendanceCalendarQueryDto {
  @ApiPropertyOptional({
    description:
      'Target Employee ID (omitted defaults to authenticated employee)',
  })
  @IsOptional()
  @IsMongoId()
  employeeId?: string;

  @ApiProperty({
    description: 'Calendar view start date (YYYY-MM-DD)',
    example: '2026-10-01',
  })
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be in YYYY-MM-DD format',
  })
  startDate!: string;

  @ApiProperty({
    description: 'Calendar view end date (YYYY-MM-DD)',
    example: '2026-10-31',
  })
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate must be in YYYY-MM-DD format',
  })
  endDate!: string;
}

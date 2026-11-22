import { IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CalendarQueryDto {
  @ApiProperty({
    description: 'Start date of the calendar window (YYYY-MM-DD)',
    example: '2026-12-01',
  })
  @IsNotEmpty({ message: 'startDate is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be in YYYY-MM-DD format',
  })
  startDate!: string;

  @ApiProperty({
    description: 'End date of the calendar window (YYYY-MM-DD)',
    example: '2026-12-31',
  })
  @IsNotEmpty({ message: 'endDate is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate must be in YYYY-MM-DD format',
  })
  endDate!: string;
}

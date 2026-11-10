import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';

export class ActivityCalendarQueryDto {
  @ApiProperty({
    example: '2026-11-01T00:00:00.000Z',
    description: 'Calendar window start date',
  })
  @IsDateString()
  @IsNotEmpty()
  startDate!: string;

  @ApiProperty({
    example: '2026-11-30T23:59:59.999Z',
    description: 'Calendar window end date (maximum 90 days from startDate)',
  })
  @IsDateString()
  @IsNotEmpty()
  endDate!: string;

  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'Optional filter by user who performed the activity',
  })
  @IsMongoId()
  @IsOptional()
  performedBy?: string;
}

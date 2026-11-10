import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty } from 'class-validator';

export class SnoozeTaskDto {
  @ApiProperty({
    example: '2026-11-06T10:00:00.000Z',
    description: 'New future timestamp for the reminder',
  })
  @IsDateString()
  @IsNotEmpty()
  snoozedUntil!: string;
}

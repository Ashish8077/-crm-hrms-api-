import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ClaimCompOffDto {
  @ApiProperty({
    description: 'Attendance date of overtime or holiday worked (YYYY-MM-DD)',
    example: '2026-10-25',
  })
  @IsNotEmpty({ message: 'attendanceDate is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'attendanceDate must be in YYYY-MM-DD format',
  })
  attendanceDate!: string;

  @ApiProperty({
    description: 'Reason and details of weekend/holiday work performed',
    example: 'Production data migration and server patching on Sunday.',
  })
  @IsNotEmpty({ message: 'Reason is required' })
  @IsString()
  @MinLength(5, { message: 'Reason must be at least 5 characters long' })
  @MaxLength(500, { message: 'Reason cannot exceed 500 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .replace(/<[^>]*>/g, '')
          .trim()
          .slice(0, 500)
      : value,
  )
  reason!: string;
}

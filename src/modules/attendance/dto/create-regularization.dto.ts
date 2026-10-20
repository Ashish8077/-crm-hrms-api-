import {
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiProperty({
    description: 'Requested check-in ISO timestamp',
    example: '2026-10-15T09:00:00.000Z',
  })
  @IsNotEmpty()
  @IsDateString()
  requestedCheckInTime!: string;

  @ApiProperty({
    description: 'Requested check-out ISO timestamp',
    example: '2026-10-15T18:00:00.000Z',
  })
  @IsNotEmpty()
  @IsDateString()
  requestedCheckOutTime!: string;

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

import {
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HalfDaySession } from '../constants/leaves.constant';

export class ApplyLeaveDto {
  @ApiProperty({
    description: 'Leave type ID applied for',
    example: '60d5ecb8b5c9c32b8c8d4e11',
  })
  @IsNotEmpty({ message: 'leaveTypeId is required' })
  @IsMongoId()
  leaveTypeId!: string;

  @ApiProperty({
    description: 'Start date of leave (YYYY-MM-DD)',
    example: '2026-12-28',
  })
  @IsNotEmpty({ message: 'startDate is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be in YYYY-MM-DD format',
  })
  startDate!: string;

  @ApiProperty({
    description: 'End date of leave (YYYY-MM-DD)',
    example: '2027-01-04',
  })
  @IsNotEmpty({ message: 'endDate is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate must be in YYYY-MM-DD format',
  })
  endDate!: string;

  @ApiPropertyOptional({
    description:
      'Whether application is for half day (only valid when startDate === endDate)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isHalfDay?: boolean = false;

  @ApiPropertyOptional({
    description:
      'Session for half-day leave (FIRST_HALF or SECOND_HALF). Required if isHalfDay is true; must be omitted or null if isHalfDay is false.',
    enum: HalfDaySession,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(HalfDaySession, {
    message: 'halfDaySession must be either FIRST_HALF or SECOND_HALF',
  })
  halfDaySession?: HalfDaySession | null;

  @ApiProperty({
    description: 'Reason for leave application',
    example: 'Attending family wedding ceremony and travel.',
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

  @ApiPropertyOptional({
    description: 'Supporting medical certificate or document URL',
    example: 'https://storage.enterprise.com/docs/medical_cert_01.pdf',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachmentUrl?: string;
}

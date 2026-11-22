import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmploymentStatus } from '../../employees/constants/employee.constant';

export class CreateLeaveTypeDto {
  @ApiProperty({ description: 'Leave type name', example: 'Casual Leave' })
  @IsNotEmpty({ message: 'Leave type name is required' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .replace(/<[^>]*>/g, '')
          .trim()
          .slice(0, 100)
      : value,
  )
  name!: string;

  @ApiProperty({ description: 'Unique leave type code', example: 'CL' })
  @IsNotEmpty({ message: 'Leave type code is required' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code must be alphanumeric with underscores or hyphens',
  })
  @MinLength(2)
  @MaxLength(20)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  code!: string;

  @ApiPropertyOptional({
    description: 'Detailed description of leave policy',
    example: 'Short-term personal emergency and casual leave.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .replace(/<[^>]*>/g, '')
          .trim()
          .slice(0, 500)
      : undefined,
  )
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether leave is paid or unpaid',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional({
    description: 'Default annual allocation in days',
    default: 0,
    example: 12,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  annualAllocation?: number;

  @ApiPropertyOptional({
    description: 'Whether half-day requests are allowed',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  allowHalfDay?: boolean;

  @ApiPropertyOptional({
    description: 'Whether negative leave balance is allowed for advance leave',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allowNegativeBalance?: boolean;

  @ApiPropertyOptional({
    description: 'Whether leave can be taken during notice period',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allowDuringNoticePeriod?: boolean;

  @ApiPropertyOptional({
    description: 'Employment statuses eligible for this leave type',
    enum: EmploymentStatus,
    isArray: true,
    example: [EmploymentStatus.ACTIVE, EmploymentStatus.PROBATION],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, {
    message:
      'applicableEmploymentStatuses must contain at least one employment status',
  })
  @IsEnum(EmploymentStatus, { each: true })
  applicableEmploymentStatuses?: EmploymentStatus[];

  @ApiPropertyOptional({
    description: 'Whether weekends falling inside leave span are deducted',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  deductWeekends?: boolean;

  @ApiPropertyOptional({
    description:
      'Whether public holidays falling inside leave span are deducted',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  deductHolidays?: boolean;

  @ApiPropertyOptional({
    description:
      'Maximum consecutive days allowed in a single application (1-90 days). ' +
      'Leave omitted or null for unlimited consecutive days.',
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  maxConsecutiveDays?: number;

  @ApiPropertyOptional({
    description: 'Whether supporting medical or audit document is required',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  requiresAttachment?: boolean;

  @ApiPropertyOptional({
    description:
      'Whether unused balance carries over to the next year. If false, maxCarryForwardDays is automatically normalized to 0.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isCarryForwardEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Maximum days eligible for carry-forward to the next calendar year. ' +
      'Set to 0 for unlimited carry-forward (capped only by remaining available balance). ' +
      'When isCarryForwardEnabled is false, this is automatically normalized to 0 upon saving.',
    default: 0,
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  maxCarryForwardDays?: number;

  @ApiPropertyOptional({
    description: 'Whether leave type is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

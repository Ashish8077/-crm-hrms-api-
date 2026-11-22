import {
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AllocateLeaveDto {
  @ApiProperty({
    description: 'Target employee ID',
    example: '60d5ecb8b5c9c32b8c8d4e11',
  })
  @IsNotEmpty({ message: 'employeeId is required' })
  @IsMongoId({ message: 'employeeId must be a valid MongoDB ObjectId' })
  employeeId!: string;

  @ApiProperty({
    description: 'Leave type ID to allocate',
    example: '60d5ecb8b5c9c32b8c8d4e33',
  })
  @IsNotEmpty({ message: 'leaveTypeId is required' })
  @IsMongoId({ message: 'leaveTypeId must be a valid MongoDB ObjectId' })
  leaveTypeId!: string;

  @ApiProperty({
    description: 'Leave year for allocation',
    example: 2026,
  })
  @IsNotEmpty({ message: 'year is required' })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiProperty({
    description:
      'Number of annual leave days allocated (must be greater than 0, maximum 2 decimal places)',
    example: 12,
  })
  @IsNotEmpty({ message: 'days is required' })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'days cannot have more than 2 decimal places' },
  )
  @Min(0.5, { message: 'days must be greater than 0' })
  @Max(365, { message: 'days cannot exceed 365' })
  days!: number;

  @ApiPropertyOptional({
    description:
      'Carried forward days from prior year (maximum 2 decimal places)',
    example: 3,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'carriedForwardDays cannot have more than 2 decimal places' },
  )
  @Min(0, { message: 'carriedForwardDays cannot be negative' })
  @Max(365, { message: 'carriedForwardDays cannot exceed 365' })
  carriedForwardDays?: number = 0;

  @ApiPropertyOptional({
    description: 'Audit remarks for allocation',
    example: 'Annual FY2026 allocation grant.',
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
  remarks?: string;
}

import {
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustLeaveBalanceDto {
  @ApiProperty({
    description: 'Target employee ID',
    example: '60d5ecb8b5c9c32b8c8d4e11',
  })
  @IsNotEmpty({ message: 'employeeId is required' })
  @IsMongoId()
  employeeId!: string;

  @ApiProperty({
    description: 'Leave type ID',
    example: '60d5ecb8b5c9c32b8c8d4e22',
  })
  @IsNotEmpty({ message: 'leaveTypeId is required' })
  @IsMongoId()
  leaveTypeId!: string;

  @ApiProperty({
    description: 'Leave year',
    example: 2026,
  })
  @IsNotEmpty({ message: 'year is required' })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiProperty({
    description: 'Adjustment action type (CREDIT or DEBIT)',
    enum: ['CREDIT', 'DEBIT'],
    example: 'CREDIT',
  })
  @IsNotEmpty({ message: 'adjustmentType is required' })
  @IsIn(['CREDIT', 'DEBIT'], {
    message: 'adjustmentType must be either CREDIT or DEBIT',
  })
  adjustmentType!: 'CREDIT' | 'DEBIT';

  @ApiProperty({
    description: 'Quantity of days to adjust (maximum 2 decimal places)',
    example: 1.5,
  })
  @IsNotEmpty({ message: 'days is required' })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'days cannot have more than 2 decimal places' },
  )
  @Min(0.5, { message: 'days must be at least 0.5' })
  @Max(90, { message: 'days cannot exceed 90' })
  days!: number;

  @ApiProperty({
    description: 'Mandatory justification / audit reason for adjustment',
    example: 'Correction for overtime worked during branch system migration.',
  })
  @IsNotEmpty({ message: 'reason is required' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
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

import {
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HolidayType } from '../constants/leaves.constant';
import { IsValidCalendarDate } from '../../../common/validation/decorators/is-valid-calendar-date.decorator';

export class CreateHolidayDto {
  @ApiProperty({ description: 'Holiday name', example: 'Republic Day' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .replace(/<[^>]*>/g, '')
          .trim()
          .slice(0, 100)
      : value,
  )
  @IsNotEmpty({ message: 'Holiday name is required' })
  @IsString({ message: 'Holiday name must be a string' })
  @MinLength(2, { message: 'Holiday name must be at least 2 characters' })
  @MaxLength(100, { message: 'Holiday name cannot exceed 100 characters' })
  name!: string;

  @ApiProperty({
    description: 'Holiday date (YYYY-MM-DD)',
    example: '2026-01-26',
  })
  @IsNotEmpty({ message: 'Date is required' })
  @IsValidCalendarDate({
    message: 'date must be a valid calendar date in YYYY-MM-DD format',
  })
  date!: string;

  @ApiPropertyOptional({
    description: 'Holiday category',
    enum: HolidayType,
    default: HolidayType.PUBLIC,
  })
  @IsOptional()
  @IsEnum(HolidayType)
  type?: HolidayType = HolidayType.PUBLIC;

  @ApiPropertyOptional({
    description:
      'Specific branch ID if regional. Omit or null for organization-wide holiday.',
    example: '60d5ecb8b5c9c32b8c8d4e11',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null || value === '' || value === 'null' ? null : value,
  )
  @ValidateIf((_, val) => val !== null && val !== undefined && val !== '')
  @IsMongoId({ message: 'branchId must be a valid MongoDB ObjectId' })
  branchId?: string | null;

  @ApiPropertyOptional({
    description: 'Description or notes for holiday',
    example: 'National Gazetted Holiday.',
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
    description: 'Whether holiday is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

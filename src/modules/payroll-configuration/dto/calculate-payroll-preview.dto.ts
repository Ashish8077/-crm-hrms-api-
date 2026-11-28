import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export enum PayrollPreviewCalculationType {
  FIXED = 'FIXED',
  PERCENTAGE = 'PERCENTAGE',
}

export class PayrollPreviewComponentInputDto {
  @ApiProperty({
    description: 'SalaryComponent ObjectId',
    example: '60d5ec49f1b2c82d8c8e4567',
  })
  @IsNotEmpty()
  @IsMongoId()
  componentId!: string;

  @ApiProperty({
    description: 'Calculation method for this component',
    enum: PayrollPreviewCalculationType,
    example: PayrollPreviewCalculationType.FIXED,
  })
  @IsNotEmpty()
  @IsEnum(PayrollPreviewCalculationType)
  calculationType!: PayrollPreviewCalculationType;

  @ApiPropertyOptional({
    description: 'Fixed amount when calculationType is FIXED',
    example: 30000,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number | null;

  @ApiPropertyOptional({
    description: 'Percentage rate (0-100) when calculationType is PERCENTAGE',
    example: 50,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  percentage?: number | null;

  @ApiPropertyOptional({
    description:
      'Percentage calculation base: BASIC, GROSS_EARNINGS, GROSS_SALARY, BASIC_AND_DA, or a component code in this preview',
    example: 'BASIC',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9_-]+$/, {
    message:
      'percentageOf must contain only uppercase alphanumeric characters, underscores, or hyphens',
  })
  percentageOf?: string | null;
}

export class CalculatePayrollPreviewDto {
  @ApiProperty({
    description: 'Components to calculate in payroll preview',
    type: [PayrollPreviewComponentInputDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PayrollPreviewComponentInputDto)
  components!: PayrollPreviewComponentInputDto[];

  @ApiPropertyOptional({
    description: 'Total days in the payroll period for proration (1-31)',
    example: 30,
    minimum: 1,
    maximum: 31,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(31)
  totalDaysInPeriod?: number;

  @ApiPropertyOptional({
    description: 'Payable days worked in the payroll period (0-31)',
    example: 30,
    minimum: 0,
    maximum: 31,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(31)
  payableDays?: number;
}

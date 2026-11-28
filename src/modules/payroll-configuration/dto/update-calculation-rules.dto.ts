import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  NegativeNetPayPolicy,
  PAYROLL_SETTINGS_CONSTANTS,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../constants/payroll-configuration.constant';

export class StatutoryCalculationFlagsDto {
  @ApiPropertyOptional({
    description: 'Enable Provident Fund (PF) deduction calculation',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  pfEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Enable Employee State Insurance (ESI) deduction calculation',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  esiEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Enable Professional Tax (PT) deduction calculation',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  ptEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Enable Tax Deducted at Source (TDS) deduction calculation',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  tdsEnabled?: boolean;
}

export class UpdateCalculationRulesDto {
  @ApiPropertyOptional({
    description: 'Financial rounding mode for payroll line items and totals',
    enum: PayrollRoundingMode,
    example: PayrollRoundingMode.HALF_EVEN,
  })
  @IsOptional()
  @IsEnum(PayrollRoundingMode)
  roundingMode?: PayrollRoundingMode;

  @ApiPropertyOptional({
    description: 'Decimal precision for rounding (0-4)',
    example: 2,
    minimum: PAYROLL_SETTINGS_CONSTANTS.ROUNDING_PRECISION_MIN,
    maximum: PAYROLL_SETTINGS_CONSTANTS.ROUNDING_PRECISION_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(PAYROLL_SETTINGS_CONSTANTS.ROUNDING_PRECISION_MIN)
  @Max(PAYROLL_SETTINGS_CONSTANTS.ROUNDING_PRECISION_MAX)
  roundingPrecision?: number;

  @ApiPropertyOptional({
    description: 'Monthly salary proration policy',
    enum: PayrollProrationPolicy,
    example: PayrollProrationPolicy.CALENDAR_DAYS,
  })
  @IsOptional()
  @IsEnum(PayrollProrationPolicy)
  prorationPolicy?: PayrollProrationPolicy;

  @ApiPropertyOptional({
    description:
      'Whether fixed earning components are prorated by payable days',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  prorateFixedComponents?: boolean;

  @ApiPropertyOptional({
    description: 'Whether deduction components are prorated by payable days',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  prorateDeductions?: boolean;

  @ApiPropertyOptional({
    description:
      'Whether employer contribution components are prorated by payable days',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  prorateEmployerContributions?: boolean;

  @ApiPropertyOptional({
    description: 'How negative net pay is handled',
    enum: NegativeNetPayPolicy,
    example: NegativeNetPayPolicy.REJECT,
  })
  @IsOptional()
  @IsEnum(NegativeNetPayPolicy)
  negativeNetPayPolicy?: NegativeNetPayPolicy;

  @ApiPropertyOptional({
    description: 'Configurable statutory calculation flags',
    type: StatutoryCalculationFlagsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => StatutoryCalculationFlagsDto)
  statutoryConfig?: StatutoryCalculationFlagsDto;

  @ApiPropertyOptional({
    description: 'Optional preferred evaluation order by component code',
    type: [String],
    example: ['BASIC', 'HRA', 'PF'],
  })
  @IsOptional()
  @IsArray()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((v: unknown) =>
          typeof v === 'string' ? v.trim().toUpperCase() : v,
        )
      : value,
  )
  @IsString({ each: true })
  @Matches(/^[A-Z0-9_-]+$/, {
    each: true,
    message:
      'componentExecutionOrder codes must contain only uppercase alphanumeric characters, underscores, or hyphens',
  })
  @ArrayUnique()
  componentExecutionOrder?: string[];

  @ApiPropertyOptional({
    description: 'Expected document version for optimistic concurrency control',
    example: 0,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}

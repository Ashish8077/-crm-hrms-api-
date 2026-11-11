import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PricingTierDto } from './pricing-tier.dto';

export class UpdateProductPricingDto {
  @ApiProperty({ example: 1500, minimum: 0 })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ example: 500, minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  costPrice?: number;

  @ApiPropertyOptional({ example: 1000, minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  floorPrice?: number;

  @ApiPropertyOptional({ example: 18, minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  taxRate?: number;

  @ApiPropertyOptional({ type: [PricingTierDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingTierDto)
  @IsOptional()
  pricingTiers?: PricingTierDto[];

  @ApiPropertyOptional({ example: 12, minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  repMaxDiscountPercent?: number;

  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  managerMaxDiscountPercent?: number;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isTaxInclusive?: boolean;

  @ApiProperty({
    example:
      'Annual enterprise price revision adjusted for inflation and feature enhancements',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

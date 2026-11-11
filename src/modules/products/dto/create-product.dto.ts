import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { BillingCycle } from '../constants/billing-cycle.constant';
import { PricingType } from '../constants/pricing-type.constant';
import { ProductType } from '../constants/product-type.constant';
import { BundleItemDto } from './bundle-item.dto';
import { PricingTierDto } from './pricing-tier.dto';

export class CreateProductDto {
  @ApiProperty({ example: 'CRM Enterprise License' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'PRD-SAAS-8F2A' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiProperty({ enum: ProductType, example: ProductType.PRODUCT })
  @IsEnum(ProductType)
  type!: ProductType;

  @ApiProperty({ example: '6ae049328c03f23ab96ce05c' })
  @IsMongoId()
  categoryId!: string;

  @ApiPropertyOptional({
    example: 'Full-featured enterprise tier CRM user license',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 1200, minimum: 0 })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ example: 400, minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  costPrice?: number;

  @ApiPropertyOptional({ example: 800, minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  floorPrice?: number;

  @ApiPropertyOptional({ example: 'INR', default: 'INR' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({
    enum: PricingType,
    default: PricingType.RECURRING,
  })
  @IsEnum(PricingType)
  @IsOptional()
  pricingType?: PricingType;

  @ApiPropertyOptional({
    enum: BillingCycle,
    default: BillingCycle.ANNUALLY,
  })
  @IsEnum(BillingCycle)
  @IsOptional()
  billingCycle?: BillingCycle;

  @ApiPropertyOptional({ example: 'USER', default: 'UNIT' })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional({ type: [PricingTierDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingTierDto)
  @IsOptional()
  pricingTiers?: PricingTierDto[];

  @ApiPropertyOptional({
    example: 10,
    minimum: 0,
    maximum: 100,
    default: 10,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  repMaxDiscountPercent?: number;

  @ApiPropertyOptional({
    example: 25,
    minimum: 0,
    maximum: 100,
    default: 25,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  managerMaxDiscountPercent?: number;

  @ApiPropertyOptional({ example: '997331' })
  @IsString()
  @IsOptional()
  hsnSacCode?: string;

  @ApiPropertyOptional({ example: 18, default: 18 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  taxRate?: number;

  @ApiPropertyOptional({ example: false, default: false })
  @IsBoolean()
  @IsOptional()
  isTaxInclusive?: boolean;

  @ApiPropertyOptional({
    example: 40,
    description: 'Hours of delivery effort for services',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedDeliveryHours?: number;

  @ApiPropertyOptional({ example: 'Senior Cloud Architect' })
  @IsString()
  @IsOptional()
  requiredSkillRole?: string;

  @ApiPropertyOptional({ type: [BundleItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BundleItemDto)
  @IsOptional()
  bundleItems?: BundleItemDto[];

  @ApiPropertyOptional({ example: ['saas', 'crm', 'enterprise'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

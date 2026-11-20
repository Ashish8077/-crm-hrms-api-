import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, [
    'sku',
    'type',
    'unitPrice',
    'costPrice',
    'floorPrice',
    'currency',
    'pricingTiers',
    'repMaxDiscountPercent',
    'managerMaxDiscountPercent',
    'taxRate',
    'isTaxInclusive',
    'bundleItems',
  ] as const),
) {}

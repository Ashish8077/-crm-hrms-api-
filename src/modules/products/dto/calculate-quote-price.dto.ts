import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class QuoteLineItemDto {
  @ApiProperty({ example: '6ae049328c03f23ab96ce05c' })
  @IsMongoId()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ example: 5, minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ example: 10, minimum: 0, maximum: 100, default: 0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  requestedDiscountPercent?: number;
}

export class CalculateQuotePriceDto {
  @ApiProperty({
    type: [QuoteLineItemDto],
    description: 'Array of products/services with quantities and discounts',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineItemDto)
  lineItems!: QuoteLineItemDto[];

  @ApiPropertyOptional({
    example: 'MH',
    description: 'Two-letter seller Indian state code',
    default: 'MH',
  })
  @IsString()
  @IsOptional()
  sellerState?: string;

  @ApiPropertyOptional({
    example: 'DL',
    description: 'Two-letter buyer Indian state code',
  })
  @IsString()
  @IsOptional()
  buyerState?: string;
}

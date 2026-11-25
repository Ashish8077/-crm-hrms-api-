import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QuotationItemDto {
  @ApiProperty({
    description: 'Catalog Product ID (ObjectId)',
    example: '6af4306b56066c516b8916fb',
  })
  @IsMongoId()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({
    description: 'Item quantity (supports up to 3 decimals, e.g. 2.5)',
    example: 2.5,
    minimum: 0.001,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1000000)
  quantity!: number;

  @ApiPropertyOptional({
    description: 'Requested discount percentage (0 to 100)',
    example: 10,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent?: number = 0;

  @ApiPropertyOptional({
    description: 'Custom line-level notes or specifications',
    example: 'Annual enterprise support SLA',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

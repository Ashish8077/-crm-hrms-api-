import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class BundleItemDto {
  @ApiProperty({ example: '6ae049328c03f23ab96ce05c' })
  @IsMongoId()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ example: 1, minimum: 1, default: 1 })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ example: 10, minimum: 0, maximum: 100, default: 0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  discountPercent?: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class PricingTierDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsNumber()
  @Min(1)
  minQuantity!: number;

  @ApiPropertyOptional({ example: 50, minimum: 1, nullable: true })
  @IsNumber()
  @Min(1)
  @IsOptional()
  maxQuantity?: number | null;

  @ApiProperty({ example: 999.99, minimum: 0 })
  @IsNumber()
  @Min(0)
  unitPrice!: number;
}

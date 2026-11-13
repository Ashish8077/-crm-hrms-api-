import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ConvertToOrderDto {
  @ApiPropertyOptional({
    description: 'Expected fulfillment/delivery completion date (ISO 8601)',
    example: '2027-02-15T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @ApiPropertyOptional({
    description: 'Special shipping, deployment, or billing fulfillment instructions',
    example: 'Provision cloud instances in Mumbai ap-south-1 region',
  })
  @IsOptional()
  @IsString()
  orderNotes?: string;

  @ApiPropertyOptional({
    description: 'Fulfillment or order notes',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Billing address object or string',
  })
  @IsOptional()
  billingAddress?: any;

  @ApiPropertyOptional({
    description: 'Shipping address object or string',
  })
  @IsOptional()
  shippingAddress?: any;
}

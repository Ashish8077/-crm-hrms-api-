import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsMongoId,
} from 'class-validator';

export class BulkUpdateProductStatusDto {
  @ApiProperty({
    example: ['6ae049328c03f23ab96ce05c', '6ae049328c03f23ab96ce05d'],
    description: 'Array of up to 50 product IDs to update status for',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsMongoId({ each: true })
  productIds!: string[];

  @ApiProperty({ example: false, description: 'Target active status' })
  @IsBoolean()
  isActive!: boolean;
}

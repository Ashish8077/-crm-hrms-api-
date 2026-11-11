import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { BundleItemDto } from './bundle-item.dto';

export class UpdateBundleItemsDto {
  @ApiProperty({
    type: [BundleItemDto],
    description: 'Array of bundle child products and quantities',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BundleItemDto)
  bundleItems!: BundleItemDto[];
}

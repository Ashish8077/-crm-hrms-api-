import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { QuotationItemDto } from './quotation-item.dto';

export class SpawnRevisionDto {
  @ApiPropertyOptional({
    description: 'Reason for creating a new revision',
    example: 'Client requested 5% additional volume discount',
  })
  @IsOptional()
  @IsString()
  revisionReason?: string;

  @ApiPropertyOptional({ description: 'Reason alias' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Updated commercial terms for new revision',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Optional updated line items for the revision',
    type: [QuotationItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items?: QuotationItemDto[];
}

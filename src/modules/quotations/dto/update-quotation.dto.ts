import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuotationItemDto } from './quotation-item.dto';

export class UpdateQuotationDto {
  @ApiPropertyOptional({ description: 'Quotation Title / Subject' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Currency code (e.g. INR, USD)' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Contact ID receiving the proposal' })
  @IsOptional()
  @IsMongoId()
  contactId?: string;

  @ApiPropertyOptional({ description: 'Associated Deal ID' })
  @IsOptional()
  @IsMongoId()
  dealId?: string;

  @ApiPropertyOptional({ description: 'Associated Lead ID' })
  @IsOptional()
  @IsMongoId()
  leadId?: string;

  @ApiPropertyOptional({ description: 'Assigned Sales Representative' })
  @IsOptional()
  @IsMongoId()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Quote expiration date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({
    description: 'Updated line items',
    type: [QuotationItemDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items?: QuotationItemDto[];

  @ApiPropertyOptional({ description: 'Seller 2-letter state code' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  sellerState?: string;

  @ApiPropertyOptional({ description: 'Buyer 2-letter state code' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  buyerState?: string;

  @ApiPropertyOptional({ description: 'Commercial terms and conditions' })
  @IsOptional()
  @IsString()
  termsAndConditions?: string;

  @ApiPropertyOptional({ description: 'Notes or remarks' })
  @IsOptional()
  @IsString()
  notes?: string;
}

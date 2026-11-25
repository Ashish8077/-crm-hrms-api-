import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuotationItemDto } from './quotation-item.dto';

export class CreateQuotationDto {
  @ApiPropertyOptional({
    description: 'Quotation Title / Subject',
    example: 'Annual Software License and Support',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Company / Account ID',
    example: '6af4306b56066c516b8916fb',
  })
  @IsOptional()
  @IsMongoId()
  companyId?: string;

  @ApiProperty({
    description: 'Contact ID receiving the proposal',
    example: '6af4306b56066c516b8916fc',
  })
  @IsMongoId()
  @IsNotEmpty()
  contactId!: string;

  @ApiPropertyOptional({
    description: 'Associated Deal ID',
    example: '6af4306b56066c516b8916fd',
  })
  @IsOptional()
  @IsMongoId()
  dealId?: string;

  @ApiPropertyOptional({
    description: 'Associated Lead ID',
    example: '6af4306b56066c516b8916fe',
  })
  @IsOptional()
  @IsMongoId()
  leadId?: string;

  @ApiPropertyOptional({
    description:
      'Assigned Sales Representative (defaults to authenticated caller)',
    example: '6af4306b56066c516b8916ff',
  })
  @IsOptional()
  @IsMongoId()
  ownerId?: string;

  @ApiProperty({
    description: 'Quote expiration date (ISO 8601)',
    example: '2026-12-31T23:59:59.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  expiryDate!: string;

  @ApiProperty({ description: 'Line items array', type: [QuotationItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items!: QuotationItemDto[];

  @ApiPropertyOptional({
    description: 'Currency code (e.g. INR, USD, EUR)',
    default: 'INR',
    example: 'INR',
  })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string = 'INR';

  @ApiPropertyOptional({
    description: 'Seller 2-letter state code for GST (defaults to DL)',
    default: 'DL',
    example: 'DL',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  sellerState?: string = 'DL';

  @ApiProperty({
    description: 'Buyer 2-letter state code for GST (e.g. MH, KA, DL)',
    example: 'MH',
  })
  @IsString()
  @Length(2, 2)
  @IsNotEmpty()
  buyerState!: string;

  @ApiPropertyOptional({ description: 'Commercial terms and conditions' })
  @IsOptional()
  @IsString()
  termsAndConditions?: string;

  @ApiPropertyOptional({ description: 'Internal or customer-facing remarks' })
  @IsOptional()
  @IsString()
  notes?: string;
}

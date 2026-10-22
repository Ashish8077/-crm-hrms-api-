import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  Max,
  IsArray,
  IsMongoId,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DealStage } from '../constants/deal-stage.constant';
import {
  DEFAULT_CURRENCY,
  DEFAULT_PIPELINE,
  DealPriority,
} from '../constants/deal.constant';

export class DealProductDto {
  @ApiProperty({ example: 'Enterprise CRM License' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'SKU-CRM-ENT' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiProperty({ example: 5, minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 1200.5, minimum: 0 })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ example: 10, minimum: 0, maximum: 100 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  discount?: number;

  @ApiPropertyOptional({ example: 'Annual recurring license' })
  @IsString()
  @IsOptional()
  description?: string;
}

export class CreateDealDto {
  @ApiProperty({ example: 'Acme Corp Enterprise Deal' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({
    example: 'Comprehensive ERP + CRM implementation opportunity.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'STANDARD', default: DEFAULT_PIPELINE })
  @IsString()
  @IsOptional()
  pipeline?: string;

  @ApiPropertyOptional({ enum: DealStage, default: DealStage.NEW })
  @IsEnum(DealStage)
  @IsOptional()
  stage?: DealStage;

  @ApiProperty({ example: 50000, minimum: 0 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ example: 'USD', default: DEFAULT_CURRENCY })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ example: 25, minimum: 0, maximum: 99 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(99)
  probability?: number;

  @ApiPropertyOptional({ example: '2026-12-31T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  expectedCloseDate?: string;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439011' })
  @IsMongoId()
  @IsOptional()
  companyId?: string;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439012' })
  @IsMongoId()
  @IsOptional()
  contactId?: string;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439013' })
  @IsMongoId()
  @IsOptional()
  ownerId?: string;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439014' })
  @IsMongoId()
  @IsOptional()
  leadId?: string;

  @ApiPropertyOptional({ type: [DealProductDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DealProductDto)
  @IsOptional()
  products?: DealProductDto[];

  @ApiPropertyOptional({ example: ['enterprise', 'q4-priority'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({ enum: DealPriority, default: DealPriority.MEDIUM })
  @IsEnum(DealPriority)
  @IsOptional()
  priority?: DealPriority;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
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
import { DealProductDto } from './create-deal.dto';
import { DealPriority } from '../constants/deal.constant';

export class UpdateDealDto {
  @ApiPropertyOptional({ example: 'Acme Corp Enterprise Deal - Expanded' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated project description.' })
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiPropertyOptional({ example: 'STANDARD' })
  @IsString()
  @IsOptional()
  pipeline?: string;

  @ApiPropertyOptional({ example: 75000, minimum: 0 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ example: 50, minimum: 0, maximum: 99 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(99)
  probability?: number;

  @ApiPropertyOptional({ example: '2027-01-31T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  expectedCloseDate?: string | null;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439011' })
  @IsMongoId()
  @IsOptional()
  companyId?: string | null;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439012' })
  @IsMongoId()
  @IsOptional()
  contactId?: string | null;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439014' })
  @IsMongoId()
  @IsOptional()
  leadId?: string | null;

  @ApiPropertyOptional({ type: [DealProductDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DealProductDto)
  @IsOptional()
  products?: DealProductDto[];

  @ApiPropertyOptional({ example: ['enterprise', 'q1-close'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({ enum: DealPriority })
  @IsEnum(DealPriority)
  @IsOptional()
  priority?: DealPriority;
}

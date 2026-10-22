import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsMongoId, IsOptional, IsString } from 'class-validator';
import { DEFAULT_CURRENCY, DEFAULT_PIPELINE } from '../constants/deal.constant';

export class ForecastQueryDto {
  @ApiPropertyOptional({ example: DEFAULT_CURRENCY, default: DEFAULT_CURRENCY })
  @IsString()
  @IsOptional()
  currency?: string = DEFAULT_CURRENCY;

  @ApiPropertyOptional({ example: DEFAULT_PIPELINE, default: DEFAULT_PIPELINE })
  @IsString()
  @IsOptional()
  pipeline?: string = DEFAULT_PIPELINE;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.999Z' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Filter forecast by sales rep user ID' })
  @IsMongoId()
  @IsOptional()
  ownerId?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ForecastQueryDto {
  @ApiPropertyOptional({ description: 'Forecast year', example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  @IsOptional()
  year?: number;

  @ApiPropertyOptional({ description: 'Quarter (1-4)', example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  @IsOptional()
  quarter?: number;

  @ApiPropertyOptional({ description: 'Currency filter', example: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;
}


import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QuotaQueryDto {
  @ApiProperty({ description: 'Target year', example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year!: number;

  @ApiPropertyOptional({ description: 'Optional month (1-12). If omitted, returns annual quotas', example: 11 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  month?: number;

  @ApiPropertyOptional({ description: 'Target currency', example: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;
}


import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class SetQuotaDto {
  @ApiProperty({ description: 'Target Sales Executive User ObjectId', example: '6af1234567890abcdef12345' })
  @IsMongoId()
  userId!: string;

  @ApiProperty({ description: 'Target year', example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year!: number;

  @ApiPropertyOptional({ description: 'Optional month (1-12). If omitted, sets annual quota', example: 11 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  month?: number;

  @ApiProperty({ description: 'Target quota amount in standard currency units', example: 150000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quotaAmount!: number;

  @ApiPropertyOptional({ description: 'Target currency code', default: 'USD', example: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string = 'USD';
}


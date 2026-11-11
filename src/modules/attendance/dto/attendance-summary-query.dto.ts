import {
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttendanceSummaryQueryDto {
  @ApiPropertyOptional({
    description:
      'Target Employee ID (omitted defaults to authenticated employee)',
  })
  @IsOptional()
  @IsMongoId()
  employeeId?: string;

  @ApiProperty({ description: 'Calendar year', example: 2026 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiProperty({ description: 'Calendar month (1-12)', example: 10 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}

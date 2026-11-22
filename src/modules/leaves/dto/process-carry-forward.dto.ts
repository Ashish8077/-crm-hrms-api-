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

export class ProcessCarryForwardDto {
  @ApiProperty({
    description: 'Source year from which unused leaves are carried forward',
    example: 2025,
  })
  @IsNotEmpty({ message: 'fromYear is required' })
  @Type(() => Number)
  @IsInt({ message: 'fromYear must be an integer' })
  @Min(2000, { message: 'fromYear must be >= 2000' })
  @Max(2100, { message: 'fromYear must be <= 2100' })
  fromYear!: number;

  @ApiProperty({
    description: 'Target year into which carried forward days are credited',
    example: 2026,
  })
  @IsNotEmpty({ message: 'toYear is required' })
  @Type(() => Number)
  @IsInt({ message: 'toYear must be an integer' })
  @Min(2000, { message: 'toYear must be >= 2000' })
  @Max(2100, { message: 'toYear must be <= 2100' })
  toYear!: number;

  @ApiPropertyOptional({
    description:
      'Optional specific leave type ID. If omitted, all carry-forward eligible types are processed.',
    example: '60d5ecb8b5c9c32b8c8d4e11',
  })
  @IsOptional()
  @IsMongoId({ message: 'leaveTypeId must be a valid MongoId' })
  leaveTypeId?: string;

  @ApiPropertyOptional({
    description:
      'Optional specific employee ID. If omitted, all active employees are processed.',
    example: '60d5ecb8b5c9c32b8c8d4e22',
  })
  @IsOptional()
  @IsMongoId({ message: 'employeeId must be a valid MongoId' })
  employeeId?: string;
}

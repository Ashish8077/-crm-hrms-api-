import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewCompOffDto {
  @ApiProperty({
    description: 'Review decision (APPROVED or REJECTED)',
    enum: ['APPROVED', 'REJECTED'],
    example: 'APPROVED',
  })
  @IsNotEmpty({ message: 'status is required' })
  @IsIn(['APPROVED', 'REJECTED'], {
    message: 'status must be either APPROVED or REJECTED',
  })
  status!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({
    description:
      'Granted comp-off days credit (0.5 for half day, 1 for full day)',
    default: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(1)
  earnedDays?: number = 1;

  @ApiPropertyOptional({
    description: 'Review remarks or rejection reason',
    example: 'Verified against server maintenance logs.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .replace(/<[^>]*>/g, '')
          .trim()
          .slice(0, 500)
      : undefined,
  )
  remarks?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { DealStage } from '../constants/deal-stage.constant';

export class ChangeDealStageDto {
  @ApiProperty({ enum: DealStage, example: DealStage.DEMO_MEETING })
  @IsEnum(DealStage)
  @IsNotEmpty()
  stage!: DealStage;

  @ApiPropertyOptional({
    example: 45,
    minimum: 0,
    maximum: 99,
    description:
      'Custom win probability. If omitted, resets to target stage default probability.',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(99)
  probability?: number;
}

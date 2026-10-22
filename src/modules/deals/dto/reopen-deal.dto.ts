import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { DealStage, OPEN_STAGES } from '../constants/deal-stage.constant';

export class ReopenDealDto {
  @ApiProperty({
    example: 'Client reopened RFP due to renewed executive budget',
    description:
      'Detailed business justification for reopening the closed opportunity (min 5 characters).',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(5, { message: 'Reopen reason must be at least 5 characters long' })
  reopenReason!: string;

  @ApiPropertyOptional({
    enum: OPEN_STAGES,
    example: DealStage.NEGOTIATION,
    description:
      'Target open stage to resume the deal in (defaults to NEGOTIATION).',
  })
  @IsEnum(OPEN_STAGES, {
    message: 'Target stage must be an active open pipeline stage',
  })
  @IsOptional()
  targetStage?: DealStage;

  @ApiPropertyOptional({
    example: 60,
    minimum: 0,
    maximum: 99,
    description:
      'Custom probability. If omitted, target stage default probability is applied.',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(99)
  probability?: number;
}

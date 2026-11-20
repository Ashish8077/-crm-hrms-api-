import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { DealStage } from '../constants/deal-stage.constant';

export class CloseDealDto {
  @ApiProperty({
    enum: [DealStage.CLOSED_WON, DealStage.CLOSED_LOST],
    example: DealStage.CLOSED_WON,
  })
  @IsEnum([DealStage.CLOSED_WON, DealStage.CLOSED_LOST], {
    message: 'Closure stage must be either CLOSED_WON or CLOSED_LOST',
  })
  @IsNotEmpty()
  stage!: DealStage.CLOSED_WON | DealStage.CLOSED_LOST;

  @ApiPropertyOptional({
    example: 'Competitor offered 30% lower price on annual subscription',
    description: 'Mandatory if deal is closed lost (min 3 characters).',
  })
  @IsString()
  @IsOptional()
  @MinLength(3, { message: 'Lost reason must be at least 3 characters long' })
  lostReason?: string;

  @ApiPropertyOptional({ example: 'Contoso Tech Inc.' })
  @IsString()
  @IsOptional()
  lostCompetitor?: string;
}

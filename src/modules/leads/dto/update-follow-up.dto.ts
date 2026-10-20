import {
  IsDate,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import { FollowUpStatus } from '../constants/lead.constant';

export class UpdateFollowUpDto {
  @ApiPropertyOptional({
    description: 'Updated scheduled date and time',
    example: '2026-10-18T14:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;

  @ApiPropertyOptional({
    description: 'Updated assigned User ID',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId()
  assignedTo?: string;

  @ApiPropertyOptional({
    description: 'Updated follow-up status',
    enum: FollowUpStatus,
  })
  @IsOptional()
  @IsEnum(FollowUpStatus)
  status?: FollowUpStatus;

  @ApiPropertyOptional({
    description: 'Updated follow-up notes/outcome',
    example: 'Customer agreed to proceed with tier 2 plan.',
  })
  @IsOptional()
  @IsString()
  @TrimString()
  notes?: string;
}

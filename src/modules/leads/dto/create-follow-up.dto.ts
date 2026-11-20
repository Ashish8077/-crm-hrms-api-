import {
  IsDate,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TrimString } from '../../../common/decorators/trim-string.decorator';
import { FollowUpStatus } from '../constants/lead.constant';

export class CreateFollowUpDto {
  @ApiProperty({
    description: 'Scheduled date and time for the follow-up',
    example: '2026-10-15T10:00:00.000Z',
  })
  @IsNotEmpty()
  @Type(() => Date)
  @IsDate()
  scheduledAt!: Date;

  @ApiProperty({
    description: 'User ID assigned to carry out the follow-up',
    example: '507f1f77bcf86cd799439011',
  })
  @IsNotEmpty()
  @IsMongoId()
  assignedTo!: string;

  @ApiPropertyOptional({
    description: 'Follow-up status',
    enum: FollowUpStatus,
    default: FollowUpStatus.PENDING,
  })
  @IsOptional()
  @IsEnum(FollowUpStatus)
  status?: FollowUpStatus;

  @ApiPropertyOptional({
    description: 'Notes or agenda for the follow-up',
    example: 'Review product proposal pricing with VP',
  })
  @IsOptional()
  @IsString()
  @TrimString()
  notes?: string;
}

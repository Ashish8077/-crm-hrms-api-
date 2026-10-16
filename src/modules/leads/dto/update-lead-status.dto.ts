import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LeadStatus } from '../constants/lead-status.constant';

export class UpdateLeadStatusDto {
  @ApiProperty({
    description: 'New status for the lead',
    enum: LeadStatus,
    example: LeadStatus.QUALIFIED,
  })
  @IsNotEmpty()
  @IsEnum(LeadStatus)
  status!: LeadStatus;
}

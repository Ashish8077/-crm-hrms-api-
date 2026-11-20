import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { QuotationStatus } from '../constants/quotation-status.constant';

export class UpdateQuotationStatusDto {
  @ApiProperty({
    description: 'Target commercial status (DRAFT, SENT, VIEWED, ACCEPTED, REJECTED, EXPIRED)',
    enum: QuotationStatus,
    example: QuotationStatus.ACCEPTED,
  })
  @IsEnum(QuotationStatus)
  @IsNotEmpty()
  status!: QuotationStatus;

  @ApiPropertyOptional({
    description: 'Mandatory reason if transitioning to REJECTED (minimum 3 characters)',
    example: 'Client decided to postpone project to next fiscal year',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  rejectionReason?: string;
}


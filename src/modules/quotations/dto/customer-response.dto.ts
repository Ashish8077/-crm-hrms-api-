import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CustomerResponseAction } from '../constants/quotation-status.constant';

export class CustomerResponseDto {
  @ApiProperty({
    description: 'Decision action: ACCEPT or REJECT',
    enum: CustomerResponseAction,
    example: CustomerResponseAction.ACCEPT,
  })
  @IsEnum(CustomerResponseAction)
  @IsNotEmpty()
  action!: CustomerResponseAction;

  @ApiPropertyOptional({
    description: 'Digital signatory full legal name (required if ACCEPT)',
    example: 'Jane Doe, VP Procurement',
  })
  @IsOptional()
  @IsString()
  digitalSignatureName?: string;

  @ApiPropertyOptional({
    description: 'Feedback or reason if proposal is rejected',
    example: 'Budget reallocation; will re-evaluate next fiscal year',
  })
  @IsOptional()
  @IsString()
  customerFeedback?: string;

  @ApiPropertyOptional({
    description: 'Alternative field for rejection reason',
    example: 'Pricing too high',
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

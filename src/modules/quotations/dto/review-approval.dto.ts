import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum ApprovalReviewAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ReviewApprovalDto {
  @ApiProperty({
    description: 'Review decision action: APPROVE or REJECT',
    enum: ApprovalReviewAction,
    example: ApprovalReviewAction.APPROVE,
  })
  @IsEnum(ApprovalReviewAction)
  @IsNotEmpty()
  action!: ApprovalReviewAction;

  @ApiPropertyOptional({
    description: 'Approval notes or feedback (mandatory if REJECT)',
    example: 'Approved based on VP commercial authorization',
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @ApiPropertyOptional({
    description: 'Optional reviewer remarks',
    example: 'Good terms negotiated',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectApprovalDto {
  @ApiProperty({
    description: 'Mandatory feedback explaining reason for approval rejection',
    example: 'Discount too aggressive; please reduce discount to under 20% or add multi-year lock',
  })
  @IsString()
  @IsNotEmpty()
  comment!: string;
}

export class ApproveQuotationDto {
  @ApiPropertyOptional({
    description: 'Optional approval notes or conditions',
    example: 'Approved per VP commercial authorization email',
  })
  @IsOptional()
  @IsString()
  comment?: string;
}

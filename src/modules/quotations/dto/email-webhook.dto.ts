import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EmailWebhookDto {
  @ApiProperty({ description: 'Provider message identifier', example: 'msg_01HZX87654321' })
  @IsString()
  @IsNotEmpty()
  messageId!: string;

  @ApiProperty({ description: 'Delivery event type', example: 'delivered', enum: ['delivered', 'bounced', 'opened', 'failed', 'clicked'] })
  @IsString()
  @IsNotEmpty()
  event!: string;

  @ApiPropertyOptional({ description: 'Recipient email address', example: 'client@example.com' })
  @IsOptional()
  @IsString()
  recipient?: string;

  @ApiPropertyOptional({ description: 'Timestamp of the delivery event' })
  @IsOptional()
  timestamp?: string | number;

  @ApiPropertyOptional({ description: 'Failure or bounce explanation' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'Webhook metadata object' })
  @IsOptional()
  metadata?: Record<string, any>;
}


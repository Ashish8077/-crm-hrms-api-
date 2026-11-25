import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class SendQuotationEmailDto {
  @ApiPropertyOptional({
    description: 'Optional recipient email override',
    example: 'client.decision.maker@example.com',
  })
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @ApiPropertyOptional({ description: 'Custom subject line for email' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({
    description: 'Personalized message included in the body',
  })
  @IsOptional()
  @IsString()
  customMessage?: string;

  @ApiPropertyOptional({ description: 'Personalized message body alias' })
  @IsOptional()
  @IsString()
  message?: string;
}

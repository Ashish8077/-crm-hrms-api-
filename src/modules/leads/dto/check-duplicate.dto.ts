import { IsEmail, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator';

export class CheckDuplicateDto {
  @ApiPropertyOptional({
    description: 'Email to check for duplicate',
    example: 'lead@example.com',
  })
  @IsOptional()
  @IsEmail()
  @TrimString()
  email?: string;

  @ApiPropertyOptional({
    description: 'Phone number to check for duplicate',
    example: '+1234567890',
  })
  @IsOptional()
  @IsString()
  @TrimString()
  phone?: string;
}

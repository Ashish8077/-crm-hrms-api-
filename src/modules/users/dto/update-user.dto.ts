import { IsEmail, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator.js';

export class UpdateUserDto {
  @ApiPropertyOptional({
    description: 'Updated email address of the user',
    example: 'jane.doe@example.com',
  })
  @IsOptional()
  @TrimString()
  @IsEmail()
  email?: string;
}

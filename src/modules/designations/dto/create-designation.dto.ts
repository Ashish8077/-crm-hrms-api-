import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator.js';

export class CreateDesignationDto {
  @ApiProperty({
    description: 'Name of the designation (e.g., Software Engineer)',
    example: 'Software Engineer',
  })
  @IsNotEmpty()
  @TrimString()
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    description: 'Description of the designation role',
    example: 'Responsible for backend system development',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(500)
  description?: string;
}

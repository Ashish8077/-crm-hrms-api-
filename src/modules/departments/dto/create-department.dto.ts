import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator.js';

export class CreateDepartmentDto {
  @ApiProperty({
    description: 'Name of the department',
    example: 'Engineering',
  })
  @IsNotEmpty()
  @TrimString()
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    description: 'Description of the department',
    example: 'Handles all technical development',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(500)
  description?: string;
}

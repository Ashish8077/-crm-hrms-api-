import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator.js';

export class CreateTeamDto {
  @ApiProperty({
    description: 'The name of the team',
    example: 'Frontend Development',
    maxLength: 100,
  })
  @IsString()
  @TrimString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    description: 'Detailed description of the team',
    example: 'Handles all web frontend applications',
    maxLength: 500,
  })
  @IsString()
  @TrimString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    description: 'The ID of the parent department',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  @IsNotEmpty()
  departmentId!: string;
}

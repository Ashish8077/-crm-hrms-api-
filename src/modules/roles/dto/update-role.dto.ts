import {
  IsString,
  MaxLength,
  IsOptional,
  IsArray,
  IsMongoId,
  ArrayMinSize,
  IsNotEmpty,
} from 'class-validator';
import { Types } from 'mongoose';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../../common/decorators/trim-string.decorator.js';

export class UpdateRoleDto {
  @ApiPropertyOptional({
    example: 'HR Manager',
    description: 'The name of the role',
  })
  @IsString()
  @TrimString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'Manages HR operations',
    description: 'Optional description of the role',
  })
  @IsString()
  @TrimString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['60d5ec49f1b2c8a2b4b8b4a2'],
    description: 'List of permission ObjectIds',
  })
  @IsArray()
  @IsOptional()
  @IsMongoId({ each: true })
  @ArrayMinSize(1, { message: 'A role must have at least one permission' })
  permissionIds?: Types.ObjectId[];
}

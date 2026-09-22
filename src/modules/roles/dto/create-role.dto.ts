import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsArray,
  IsMongoId,
  ArrayMinSize,
  Matches,
} from 'class-validator';
import { Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({ example: 'HR Manager', description: 'The name of the role' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: 'hr-manager',
    description: 'Unique identifier key for the role',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^(?=.*[a-z])[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'Key must contain at least one lowercase letter and may contain numbers and hyphens',
  })
  key!: string;

  @ApiPropertyOptional({
    example: 'Manages HR operations',
    description: 'Optional description of the role',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiProperty({
    type: [String],
    example: ['60d5ec49f1b2c8a2b4b8b4a2'],
    description: 'List of permission ObjectIds',
  })
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMinSize(1, { message: 'A role must have at least one permission' })
  permissionIds!: Types.ObjectId[];
}

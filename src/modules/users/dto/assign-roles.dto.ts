import { IsArray, IsMongoId } from 'class-validator';
import { Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export class AssignRolesDto {
  @ApiProperty({
    description: 'Array of role IDs to assign to the user',
    type: [String],
    example: ['65b1c9e8d4a3e2f1a8b9c0d1'],
  })
  @IsArray()
  @IsMongoId({ each: true })
  roleIds!: Types.ObjectId[];
}

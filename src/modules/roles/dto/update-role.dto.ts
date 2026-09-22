import {
  IsString,
  MaxLength,
  IsOptional,
  IsArray,
  IsMongoId,
  ArrayMinSize,
} from 'class-validator';
import { Types } from 'mongoose';

export class UpdateRoleDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @IsArray()
  @IsOptional()
  @IsMongoId({ each: true })
  @ArrayMinSize(1, { message: 'A role must have at least one permission' })
  permissionIds?: Types.ObjectId[];
}

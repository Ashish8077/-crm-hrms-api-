import { IsArray, IsMongoId } from 'class-validator';
import { Types } from 'mongoose';

export class AssignRolesDto {
  @IsArray()
  @IsMongoId({ each: true })
  roleIds!: Types.ObjectId[];
}

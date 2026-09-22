import { Types } from 'mongoose';
import { Role } from '../schemas/role.schema';

export interface CreateCustomRoleData {
  key: string;
  name: string;
  description?: string;
  permissionIds: Types.ObjectId[];
  isSystemRole: boolean;
  isActive: boolean;
}

export interface UpdateCustomRoleData {
  name?: string;
  description?: string;
  permissionIds?: Types.ObjectId[];
}

export type RoleLean = Role & {
  _id: Types.ObjectId;
};

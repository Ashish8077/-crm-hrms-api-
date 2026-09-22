import { Types } from 'mongoose';
import { CreateRoleDto } from '../dto/create-role.dto';

import {
  CreateCustomRoleData,
  UpdateCustomRoleData,
} from '../types/role.repository.types';
import { RoleDocument } from '../schemas/role.schema';
import { UpdateRoleDto } from '../dto/update-role.dto';

export interface RoleResponse {
  id: string;
  key: string;
  name: string;
  description?: string;
  isSystemRole: boolean;
  isActive: boolean;
  permissionIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class RoleMapper {
  static toCreateRole(
    dto: CreateRoleDto,
    permissionIds: Types.ObjectId[],
  ): CreateCustomRoleData {
    return {
      key: dto.key,
      name: dto.name,
      description: dto.description,
      permissionIds,
      isSystemRole: false,
      isActive: true,
    };
  }

  static toUpdateRole(
    dto: UpdateRoleDto,
    permissionIds?: Types.ObjectId[],
  ): UpdateCustomRoleData {
    const data: UpdateCustomRoleData = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }

    if (dto.description !== undefined) {
      data.description = dto.description;
    }

    if (permissionIds !== undefined) {
      data.permissionIds = permissionIds;
    }

    return data;
  }

  static toResponse(role: RoleDocument): RoleResponse {
    return {
      id: role._id.toString(),
      key: role.key,
      name: role.name,
      description: role.description,
      isSystemRole: role.isSystemRole,
      isActive: role.isActive,
      permissionIds: role.permissionIds.map((id) => id.toString()),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}

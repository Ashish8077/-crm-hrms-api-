import { Injectable, HttpStatus } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, Connection, ClientSession } from 'mongoose';
import { RoleRepository } from './repositories/role.repository';
import { PermissionRepository } from '../permissions/repositories/permission.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateRoleStatusDto } from './dto/update-role-status.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { RoleDocument } from './schemas/role.schema';
import { RoleMapper, RoleResponse } from './mappers/role.mapper';
import { ClientMetadata } from '../auth/types/auth.types';

import { GetRolesQueryDto } from './dto/get-roles-query.dto';
import { escapeRegExp } from '../../common/utils/regex.util';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import {
  calculateSkip,
  buildPaginationMeta,
} from '../../common/pagination/pagination.util';

type RoleChange = {
  from: unknown;
  to: unknown;
};

@Injectable()
export class RolesService {
  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly permissionRepository: PermissionRepository,
    private readonly auditLogsService: AuditLogsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(
    dto: CreateRoleDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<RoleResponse> {
    const { ipAddress, userAgent } = clientMetadata;

    const existingRole = await this.roleRepository.findByKey(dto.key);
    if (existingRole) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        `Role with key '${dto.key}' already exists`,
        HttpStatus.CONFLICT,
      );
    }

    const uniquePermissionIds = Array.from(
      new Set(dto.permissionIds.map((id) => id.toString())),
    ).map((id) => new Types.ObjectId(id));

    await this.validatePermissions(uniquePermissionIds);

    const roleData = RoleMapper.toCreateRole(dto, uniquePermissionIds);

    const newRole = await this.connection.transaction(
      async (session: ClientSession) => {
        const role = await this.roleRepository.createCustomRole(
          roleData,
          session,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ROLE_CREATED,
            targetId: role._id,
            targetModel: AuditTargetModel.ROLE,
            details: {
              key: role.key,
              name: role.name,
            },
            userAgent,
            ipAddress,
          },
          session,
        );
        return role;
      },
    );

    return RoleMapper.toResponse(newRole);
  }

  async findAll(
    query: GetRolesQueryDto,
  ): Promise<PaginatedResult<RoleResponse>> {
    const { page = 1, limit = 20, isActive, isSystemRole, search } = query;
    const skip = calculateSkip(page, limit);

    const filter: Record<string, unknown> = {};

    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    if (isSystemRole !== undefined) {
      filter.isSystemRole = isSystemRole;
    }

    if (search) {
      const cleanSearch = escapeRegExp(search.trim());
      filter.$or = [
        { name: { $regex: cleanSearch, $options: 'i' } },
        { key: { $regex: cleanSearch, $options: 'i' } },
      ];
    }

    const { roles, total } = await this.roleRepository.findPaginated(
      skip,
      limit,
      filter,
    );

    return {
      data: roles.map((role) => RoleMapper.toResponse(role as RoleDocument)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async update(
    id: Types.ObjectId,
    data: UpdateRoleDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<RoleResponse> {
    const { ipAddress, userAgent } = clientMetadata;

    if (
      data.name === undefined &&
      data.description === undefined &&
      data.permissionIds === undefined
    ) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'At least one field must be provided for update',
        HttpStatus.BAD_REQUEST,
      );
    }

    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Role not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const changes: Record<string, RoleChange> = {};

    if (data.name !== undefined && data.name !== role.name) {
      changes.name = { from: role.name, to: data.name };
    }

    if (
      data.description !== undefined &&
      data.description !== role.description
    ) {
      changes.description = {
        from: role.description ?? undefined,
        to: data.description,
      };
    }

    let uniquePermissionIds: Types.ObjectId[] | undefined;

    if (data.permissionIds !== undefined) {
      uniquePermissionIds = Array.from(
        new Set(
          data.permissionIds.map((permissionId) => permissionId.toString()),
        ),
      ).map((permissionId) => new Types.ObjectId(permissionId));

      const existingPermissions = new Set(
        role.permissionIds.map((id) => id.toString()),
      );
      const newPermissions = new Set(
        uniquePermissionIds.map((id) => id.toString()),
      );

      let isPermissionsChanged =
        existingPermissions.size !== newPermissions.size;
      if (!isPermissionsChanged) {
        for (const perm of existingPermissions) {
          if (!newPermissions.has(perm)) {
            isPermissionsChanged = true;
            break;
          }
        }
      }

      if (isPermissionsChanged) {
        changes.permissionIds = {
          from: role.permissionIds.map((id) => id.toString()),
          to: uniquePermissionIds.map((id) => id.toString()),
        };
        await this.validatePermissions(uniquePermissionIds);
      } else {
        uniquePermissionIds = undefined;
      }
    }

    if (Object.keys(changes).length === 0) {
      return RoleMapper.toResponse(role as unknown as RoleDocument);
    }
    const updateData = RoleMapper.toUpdateRole(
      {
        name: changes.name ? data.name : undefined,
        description: changes.description ? data.description : undefined,
      },
      uniquePermissionIds,
    );

    const updatedRole = await this.connection.transaction(
      async (session: ClientSession) => {
        const updated = await this.roleRepository.updateCustomRole(
          id,
          updateData,
          session,
        );

        if (!updated) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Role not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ROLE_UPDATED,
            targetId: updated._id,
            targetModel: AuditTargetModel.ROLE,
            details: { changes },
            ipAddress,
            userAgent,
          },
          session,
        );

        return updated;
      },
    );

    return RoleMapper.toResponse(updatedRole);
  }

  async updateStatus(
    id: Types.ObjectId,
    data: UpdateRoleStatusDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<RoleResponse> {
    const { ipAddress, userAgent } = clientMetadata;
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Role not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (role.isSystemRole) {
      throw new AppError(
        ErrorCode.FORBIDDEN, // Needs a specific error like SYSTEM_ROLE_PROTECTED ideally
        'System roles cannot be deactivated or have their status changed',
        HttpStatus.FORBIDDEN,
      );
    }

    if (role.isActive === data.isActive) {
      return RoleMapper.toResponse(role as RoleDocument);
    }

    const updatedRole = await this.connection.transaction(
      async (session: ClientSession) => {
        const updated = await this.roleRepository.updateStatus(
          id,
          data.isActive,
          session,
        );
        if (!updated) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Role not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.ROLE_STATUS_CHANGED,
            targetId: updated._id,
            targetModel: AuditTargetModel.ROLE,
            details: {
              isActive: {
                from: role.isActive,
                to: data.isActive,
              },
            },
            ipAddress,
            userAgent,
          },
          session,
        );

        return updated;
      },
    );

    return RoleMapper.toResponse(updatedRole as RoleDocument);
  }

  async findById(id: Types.ObjectId): Promise<RoleResponse> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Role not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return RoleMapper.toResponse(role as RoleDocument);
  }

  private async validatePermissions(
    uniqueIds: Types.ObjectId[],
  ): Promise<void> {
    const activePermissions =
      await this.permissionRepository.findActiveByIds(uniqueIds);
    if (activePermissions.length !== uniqueIds.length) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'One or more assigned permissions are invalid, inactive, or do not exist',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

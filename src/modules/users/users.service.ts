import { Injectable, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types, ClientSession } from 'mongoose';
import { UserLean, UserRepository } from './repositories/user.repository';
import { RoleRepository } from '../roles/repositories/role.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthorizationService } from '../authorization/authorization.service';
import {
  AuditAction,
  AuditTargetModel,
} from '../audit-logs/constants/audit-log.constant';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ClientMetadata } from '../../common/types/client-metadata.type';
import { SystemRole } from '../roles/constants/role.constant';
import { RoleLean } from '../roles/types/role.repository.types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { PaginatedResult } from '../../common/pagination/types/pagination.types';
import { User, UserDocument } from './schemas/user.schema';
import { PasswordUtil } from '../../common/utils/password.util';
import { SessionRepository } from '../auth/repositories/session.repository';
import { UserStatus } from './constants/user-status.constant';
import { getChangedFields } from '../../common/utils/change-detection.util';
import {
  UserMapper,
  UserMapperInput,
  UserResponse,
} from './mappers/user.mapper';

export type UserRoleAssignmentAuditDetails = {
  oldRoleIds: string[];
  newRoleIds: string[];
};

@Injectable()
export class UsersService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly roleRepository: RoleRepository,
    private readonly auditLogsService: AuditLogsService,
    @Inject(forwardRef(() => SessionRepository))
    private readonly sessionRepository: SessionRepository,
    @Inject(forwardRef(() => AuthorizationService))
    private readonly authorizationService: AuthorizationService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async assignRoles(
    userId: Types.ObjectId,
    dto: AssignRolesDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<void> {
    const { ipAddress, userAgent } = clientMetadata;

    if (actorId.equals(userId)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Cannot assign roles to yourself',
        HttpStatus.FORBIDDEN,
      );
    }

    // Deduplicate role IDs
    const uniqueIds = Array.from(
      new Set(dto.roleIds.map((id) => id.toString())),
    ).map((id) => new Types.ObjectId(id));

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.authorizationService.assertIsActiveSuperAdmin(
          actorId,
          session,
        );

        const user = await this.assertTargetIsNotSuperAdmin(userId, session);

        let activeRoles: RoleLean[] = [];
        if (uniqueIds.length > 0) {
          activeRoles = await this.roleRepository.findActiveByIds(uniqueIds);
          if (activeRoles.length !== uniqueIds.length) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              'One or more assigned roles are invalid, inactive, or do not exist',
              HttpStatus.BAD_REQUEST,
            );
          }
        }

        const oldRoleIdsStr = (user.roleIds || [])
          .map((id: Types.ObjectId) => id.toString())
          .sort();
        const newRoleIdsStr = uniqueIds
          .map((id: Types.ObjectId) => id.toString())
          .sort();

        const isNoOp =
          oldRoleIdsStr.length === newRoleIdsStr.length &&
          oldRoleIdsStr.every((id, index) => id === newRoleIdsStr[index]);

        if (isNoOp) {
          return;
        }

        const isTargetingSuperAdmin = activeRoles.some(
          (r) => r.key === (SystemRole.SUPER_ADMIN as string),
        );

        if (isTargetingSuperAdmin) {
          throw new AppError(
            ErrorCode.FORBIDDEN,
            'Cannot assign SUPER_ADMIN role. There must be exactly one Super Admin.',
            HttpStatus.FORBIDDEN,
          );
        }

        await this.userRepository.updateRoles(userId, uniqueIds, session);

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.USER_ROLES_ASSIGNED,
            targetId: userId,
            targetModel: AuditTargetModel.USER,
            details: {
              oldRoleIds: oldRoleIdsStr,
              newRoleIds: newRoleIdsStr,
            } satisfies UserRoleAssignmentAuditDetails,
            ipAddress,
            userAgent,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }

  async create(
    dto: CreateUserDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<UserResponse> {
    const existingUser = await this.userRepository.findByEmail(dto.email);
    if (existingUser) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        'User with this email already exists',
        HttpStatus.CONFLICT,
      );
    }

    const passwordHash = await PasswordUtil.hash(dto.password);

    const session = await this.connection.startSession();
    try {
      let createdUser: UserDocument;

      await session.withTransaction(async () => {
        createdUser = await this.userRepository.create(
          {
            email: dto.email,
            passwordHash,
            createdBy: actorId,
          },
          session,
        );

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.USER_CREATED,
            targetId: createdUser._id,
            targetModel: AuditTargetModel.USER,
            details: { email: createdUser.email },
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });

      return UserMapper.toResponse(createdUser!);
    } finally {
      await session.endSession();
    }
  }

  async list(query: ListUsersQueryDto): Promise<PaginatedResult<UserResponse>> {
    const superAdminRole = await this.roleRepository.findByKey(
      SystemRole.SUPER_ADMIN,
    );
    const excludedRoleIds = superAdminRole ? [superAdminRole._id] : [];

    const result = await this.userRepository.findList(query, excludedRoleIds);
    return {
      ...result,
      data: result.data.map((user) =>
        UserMapper.toResponse(user as UserMapperInput),
      ),
    };
  }

  async getById(userId: Types.ObjectId): Promise<UserResponse> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (user.roleIds && user.roleIds.length > 0) {
      const activeRoles = await this.roleRepository.findActiveByIds(
        user.roleIds,
      );
      const isSuperAdmin = activeRoles.some(
        (r) => r.key === (SystemRole.SUPER_ADMIN as string),
      );
      if (isSuperAdmin) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'User not found',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    return UserMapper.toResponse(user);
  }

  async update(
    userId: Types.ObjectId,
    dto: UpdateUserDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<UserResponse> {
    if (dto.email !== undefined) {
      const existingUser = await this.userRepository.findByEmail(
        dto.email,
        userId,
      );
      if (existingUser) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'User with this email already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    const session = await this.connection.startSession();
    try {
      let updatedUser: UserLean | null;

      await session.withTransaction(async () => {
        const userBefore = await this.assertTargetIsNotSuperAdmin(
          userId,
          session,
        );

        const updateData: Record<string, unknown> = {};
        if (dto.email !== undefined) {
          updateData.email = dto.email;
        }

        const changedFields = getChangedFields(
          updateData,
          userBefore as unknown as Record<string, unknown>,
        );

        if (Object.keys(changedFields).length === 0) {
          updatedUser = userBefore as unknown as UserLean;
          return;
        }

        updatedUser = await this.userRepository.updateById(
          userId,
          { ...changedFields, updatedBy: actorId },
          session,
        );

        if (!updatedUser) {
          throw new AppError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'User not found',
            HttpStatus.NOT_FOUND,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.USER_UPDATED,
            targetId: userId,
            targetModel: AuditTargetModel.USER,
            details: UserMapper.toUpdateAuditDetails(
              userBefore as UserMapperInput,
              updatedUser,
            ),
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });

      return UserMapper.toResponse(updatedUser!);
    } finally {
      await session.endSession();
    }
  }

  async updateStatus(
    userId: Types.ObjectId,
    dto: UpdateUserStatusDto,
    actorId: Types.ObjectId,
    clientMetadata: ClientMetadata,
  ): Promise<UserResponse> {
    if (actorId.equals(userId)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Cannot change your own status',
        HttpStatus.FORBIDDEN,
      );
    }

    const session = await this.connection.startSession();
    try {
      let updatedUser: UserLean | null;

      await session.withTransaction(async () => {
        const user = await this.assertTargetIsNotSuperAdmin(userId, session);

        if (user.status === dto.status) {
          updatedUser = user as unknown as UserLean;
          return;
        }

        updatedUser = await this.userRepository.updateStatus(
          userId,
          dto.status,
          session,
        );

        if (
          dto.status === UserStatus.INACTIVE ||
          dto.status === UserStatus.LOCKED
        ) {
          await this.sessionRepository.revokeAllSessionsForUser(
            userId,
            new Date(),
            session,
          );
        }

        await this.auditLogsService.createAuditLog(
          {
            actorId,
            action: AuditAction.USER_STATUS_CHANGED,
            targetId: userId,
            targetModel: AuditTargetModel.USER,
            details: { oldStatus: user.status, newStatus: dto.status },
            ipAddress: clientMetadata.ipAddress,
            userAgent: clientMetadata.userAgent,
          },
          session,
        );
      });

      return UserMapper.toResponse(updatedUser!);
    } finally {
      await session.endSession();
    }
  }
  private async assertTargetIsNotSuperAdmin(
    targetUserId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<User> {
    const user = await this.userRepository.findById(targetUserId, session);
    if (!user) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (user.roleIds && user.roleIds.length > 0) {
      const activeRoles = await this.roleRepository.findActiveByIds(
        user.roleIds,
        session,
      );
      const isSuperAdmin = activeRoles.some(
        (r) => r.key === (SystemRole.SUPER_ADMIN as string),
      );
      if (isSuperAdmin) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Cannot modify protected Super Admin account',
          HttpStatus.FORBIDDEN,
        );
      }
    }
    return user;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { UserRepository } from '../users/repositories/user.repository';
import { RoleRepository } from '../roles/repositories/role.repository';
import { PermissionRepository } from '../permissions/repositories/permission.repository';
import { UserStatus } from '../users/constants/user-status.constant';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { HttpStatus } from '@nestjs/common';
import { SystemRole } from '../roles/constants/role.constant';

@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly roleRepository: RoleRepository,
    private readonly permissionRepository: PermissionRepository,
  ) {}

  /**
   * Evaluates if a user has the required permission.
   */
  async hasPermission(
    userId: Types.ObjectId,
    requiredPermissionKey: string,
  ): Promise<boolean> {
    const user = await this.userRepository.findById(userId);

    if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt) {
      return false;
    }

    if (!user.roleIds?.length) {
      return false;
    }

    const requiredPermission = await this.permissionRepository.findActiveByKey(
      requiredPermissionKey,
    );

    if (!requiredPermission) {
      this.logger.warn(
        `Permission key '${requiredPermissionKey}' not found or inactive`,
      );
      return false;
    }

    const activeRoles = await this.roleRepository.findActiveByIds(user.roleIds);

    if (!activeRoles.length) {
      return false;
    }

    // Implicit bypass for SUPER_ADMIN
    const isSuperAdmin = activeRoles.some(
      (role) => role.key === (SystemRole.SUPER_ADMIN as string),
    );
    if (isSuperAdmin) {
      return true;
    }

    const requiredPermissionId = requiredPermission._id.toString();

    return activeRoles.some((role) =>
      role.permissionIds.some(
        (permissionId) => permissionId.toString() === requiredPermissionId,
      ),
    );
  }

  /**
   * Asserts that a user is an active Super Admin.
   * Business Rule: ONLY an active Super Admin can assign roles.
   */
  async assertIsActiveSuperAdmin(
    userId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const user = await this.userRepository.findById(userId, session);
    if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt) {
      throw new AppError(
        ErrorCode.UNAUTHORIZED,
        'Actor not found or inactive',
        HttpStatus.UNAUTHORIZED,
      );
    }

    let isActorSuperAdmin = false;
    if (user.roleIds && user.roleIds.length > 0) {
      const actorRoles = await this.roleRepository.findActiveByIds(
        user.roleIds,
        session,
      );
      isActorSuperAdmin = actorRoles.some(
        (r) => r.key === (SystemRole.SUPER_ADMIN as string),
      );
    }

    if (!isActorSuperAdmin) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only Super Admins can assign roles',
        HttpStatus.FORBIDDEN,
      );
    }
  }
}

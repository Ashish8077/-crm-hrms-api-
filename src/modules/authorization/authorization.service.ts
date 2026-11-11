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
   * Evaluates if the user's roles grant all required permissions in batch.
   */
  async hasPermissions(
    roleIds: Types.ObjectId[],
    requiredPermissionKeys: string[],
  ): Promise<boolean> {
    if (!requiredPermissionKeys?.length) {
      return true;
    }

    if (!roleIds?.length) {
      return false;
    }

    // Deduplicate input keys and role IDs to ensure clean DB queries
    const uniquePermissionKeys = Array.from(new Set(requiredPermissionKeys));
    if (!uniquePermissionKeys.length) {
      return true;
    }

    const uniqueRoleIds = Array.from(
      new Set(roleIds.map((id) => id.toString())),
    ).map((idStr) => new Types.ObjectId(idStr));

    // Execute exactly 1 batch Permission query and 1 batch Role query concurrently
    const [activePermissions, activeRoles] = await Promise.all([
      this.permissionRepository.findActiveByKeys(uniquePermissionKeys),
      this.roleRepository.findActiveByIds(uniqueRoleIds),
    ]);

    // If any required permission is inactive or not found in DB, deny access
    if (activePermissions.length !== uniquePermissionKeys.length) {
      const foundKeys = new Set(activePermissions.map((p) => p.key));
      const missingKeys = uniquePermissionKeys.filter((k) => !foundKeys.has(k));
      this.logger.warn(
        `Permission key(s) not found or inactive: ${missingKeys.join(', ')}`,
      );
      return false;
    }

    // If user has no active roles, deny access
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

    // Collect all permission IDs granted by user's active roles for O(1) in-memory lookup
    const grantedPermissionIdSet = new Set<string>();
    for (const role of activeRoles) {
      if (role.permissionIds) {
        for (const permissionId of role.permissionIds) {
          grantedPermissionIdSet.add(permissionId.toString());
        }
      }
    }

    // Enforce ALL semantics: every required active permission must be in grantedPermissionIdSet
    return activePermissions.every((permission) =>
      grantedPermissionIdSet.has(permission._id.toString()),
    );
  }

  /**
   * Evaluates if a user (by userId) or a list of roles (by roleIds) has the required permission.
   */
  async hasPermission(
    userOrRoleIds: Types.ObjectId | Types.ObjectId[],
    requiredPermissionKey: string,
  ): Promise<boolean> {
    if (Array.isArray(userOrRoleIds)) {
      return this.hasPermissions(userOrRoleIds, [requiredPermissionKey]);
    }

    const user = await this.userRepository.findById(userOrRoleIds);
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      user.deletedAt ||
      !user.roleIds?.length
    ) {
      return false;
    }

    return this.hasPermissions(user.roleIds, [requiredPermissionKey]);
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

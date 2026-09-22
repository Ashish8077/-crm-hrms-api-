import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRepository } from '../../users/repositories/user.repository';
import { RoleRepository } from '../../roles/repositories/role.repository';
import { PermissionRepository } from '../../permissions/repositories/permission.repository';
import { UserStatus } from '../../users/constants/user-status.constant';

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
    try {
      // 1. Validate User
      const user = await this.userRepository.findById(userId);
      if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt) {
        return false;
      }

      if (!user.roleIds || user.roleIds.length === 0) {
        return false;
      }

      // 2. Resolve Required Permission
      const requiredPermission =
        await this.permissionRepository.findActiveByKey(requiredPermissionKey);
      if (!requiredPermission) {
        this.logger.warn(
          `Permission key '${requiredPermissionKey}' not found or inactive`,
        );
        return false;
      }

      // 3. Resolve User Roles (only active ones)
      const activeRoles = await this.roleRepository.findActiveByIds(
        user.roleIds,
      );
      if (activeRoles.length === 0) {
        return false;
      }

      // 4. Check if any active role contains the required permission ID
      const requiredPermIdStr = requiredPermission._id.toString();
      for (const role of activeRoles) {
        if (
          role.permissionIds.some((pId) => pId.toString() === requiredPermIdStr)
        ) {
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.error(
        `Error evaluating permissions for user ${userId.toString()}`,
        (error as Error).stack,
      );
      return false;
    }
  }
}

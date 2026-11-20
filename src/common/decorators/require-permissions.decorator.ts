import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSIONS_KEY = 'require_permissions';

/**
 * Decorator to enforce RBAC permissions on a route.
 * Usage: @RequirePermissions('roles.create', 'users.view')
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);

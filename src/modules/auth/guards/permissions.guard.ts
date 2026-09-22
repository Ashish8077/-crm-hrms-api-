import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from '../authorization/authorization.service';
import { REQUIRE_PERMISSIONS_KEY } from '../../../common/decorators/require-permissions.decorator';
import { AuthenticatedRequest } from '../types/auth-request.type';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new AppError(
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Check permissions (evaluate all required permissions)
    for (const permission of requiredPermissions) {
      const hasAccess = await this.authorizationService.hasPermission(
        user.userId,
        permission,
      );
      if (!hasAccess) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          `Insufficient permission. Required: ${permission}`,
          HttpStatus.FORBIDDEN,
        );
      }
    }

    return true;
  }
}

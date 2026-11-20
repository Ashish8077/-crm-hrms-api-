/* eslint-disable @typescript-eslint/unbound-method */
import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { PermissionsGuard } from './permissions.guard';
import { AuthorizationService } from '../authorization.service';
import { ErrorCode } from '../../../common/errors/error-codes';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: jest.Mocked<Reflector>;
  let authorizationService: jest.Mocked<AuthorizationService>;
  let context: jest.Mocked<ExecutionContext>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    authorizationService = {
      hasPermissions: jest.fn(),
      hasPermission: jest.fn(),
    } as unknown as jest.Mocked<AuthorizationService>;

    guard = new PermissionsGuard(reflector, authorizationService);

    context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn(),
      }),
    } as unknown as jest.Mocked<ExecutionContext>;
  });

  it('should allow access if no permissions are required', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(authorizationService.hasPermissions).not.toHaveBeenCalled();
  });

  it('should throw UNAUTHORIZED if user is not authenticated', async () => {
    reflector.getAllAndOverride.mockReturnValue(['roles.view']);
    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: undefined,
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
      statusCode: HttpStatus.UNAUTHORIZED,
    });
  });

  it('should throw FORBIDDEN if user lacks required permission', async () => {
    const roleId = new Types.ObjectId();
    reflector.getAllAndOverride.mockReturnValue(['roles.view']);
    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: {
        userId: new Types.ObjectId(),
        sessionId: new Types.ObjectId(),
        roleIds: [roleId],
      },
    });
    authorizationService.hasPermissions.mockResolvedValue(false);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      statusCode: HttpStatus.FORBIDDEN,
      message: 'Insufficient permission. Required: roles.view',
    });
    expect(authorizationService.hasPermissions).toHaveBeenCalledWith(
      [roleId],
      ['roles.view'],
    );
  });

  it('should allow access if user has required permission', async () => {
    const roleId = new Types.ObjectId();
    reflector.getAllAndOverride.mockReturnValue(['roles.view']);
    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: {
        userId: new Types.ObjectId(),
        sessionId: new Types.ObjectId(),
        roleIds: [roleId],
      },
    });
    authorizationService.hasPermissions.mockResolvedValue(true);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(authorizationService.hasPermissions).toHaveBeenCalledWith(
      [roleId],
      ['roles.view'],
    );
  });

  it('should enforce AND semantics for multiple permissions in batch (fail if missing)', async () => {
    const roleId = new Types.ObjectId();
    reflector.getAllAndOverride.mockReturnValue(['roles.view', 'roles.edit']);
    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: {
        userId: new Types.ObjectId(),
        sessionId: new Types.ObjectId(),
        roleIds: [roleId],
      },
    });

    authorizationService.hasPermissions.mockResolvedValue(false);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      statusCode: HttpStatus.FORBIDDEN,
      message: 'Insufficient permission. Required: roles.view, roles.edit',
    });
    expect(authorizationService.hasPermissions).toHaveBeenCalledWith(
      [roleId],
      ['roles.view', 'roles.edit'],
    );
  });

  it('should enforce AND semantics for multiple permissions in batch (success if all match in 1 batch call)', async () => {
    const roleId = new Types.ObjectId();
    reflector.getAllAndOverride.mockReturnValue(['roles.view', 'roles.edit']);
    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: {
        userId: new Types.ObjectId(),
        sessionId: new Types.ObjectId(),
        roleIds: [roleId],
      },
    });

    authorizationService.hasPermissions.mockResolvedValue(true);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(authorizationService.hasPermissions).toHaveBeenCalledTimes(1);
    expect(authorizationService.hasPermissions).toHaveBeenCalledWith(
      [roleId],
      ['roles.view', 'roles.edit'],
    );
  });

  it('should propagate authorization service errors', async () => {
    const roleId = new Types.ObjectId();
    reflector.getAllAndOverride.mockReturnValue(['roles.view']);
    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: {
        userId: new Types.ObjectId(),
        sessionId: new Types.ObjectId(),
        roleIds: [roleId],
      },
    });

    const dbError = new Error('Database connection failed');
    authorizationService.hasPermissions.mockRejectedValue(dbError);

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Database connection failed',
    );
  });
});

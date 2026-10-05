import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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
    expect(authorizationService.hasPermission.mock.calls.length).toBe(0);
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
    reflector.getAllAndOverride.mockReturnValue(['roles.view']);
    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: { userId: 'user-1' },
    });
    authorizationService.hasPermission.mockResolvedValue(false);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      statusCode: HttpStatus.FORBIDDEN,
    });
  });

  it('should allow access if user has required permission', async () => {
    reflector.getAllAndOverride.mockReturnValue(['roles.view']);
    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: { userId: 'user-1' },
    });
    authorizationService.hasPermission.mockResolvedValue(true);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should enforce AND semantics for multiple permissions (fail if one is missing)', async () => {
    reflector.getAllAndOverride.mockReturnValue(['roles.view', 'roles.edit']);
    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: { userId: 'user-1' },
    });

    authorizationService.hasPermission
      .mockResolvedValueOnce(true) // roles.view
      .mockResolvedValueOnce(false); // roles.edit

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      statusCode: HttpStatus.FORBIDDEN,
      message: 'Insufficient permission. Required: roles.edit',
    });
  });

  it('should enforce AND semantics for multiple permissions (success if all match)', async () => {
    reflector.getAllAndOverride.mockReturnValue(['roles.view', 'roles.edit']);
    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: { userId: 'user-1' },
    });

    authorizationService.hasPermission.mockResolvedValue(true);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(authorizationService.hasPermission.mock.calls.length).toBe(2);
  });

  it('should propagate authorization service errors', async () => {
    reflector.getAllAndOverride.mockReturnValue(['roles.view']);
    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      user: { userId: 'user-1' },
    });

    const dbError = new Error('Database connection failed');
    authorizationService.hasPermission.mockRejectedValue(dbError);

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Database connection failed',
    );
  });
});

/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SessionRepository } from '../repositories/session.repository';
import { UserRepository } from '../../users/repositories/user.repository';
import { UserStatus } from '../../users/constants/user-status.constant';
import { ACCESS_TOKEN_COOKIE } from '../constants/auth.constants';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AuthenticatedRequest } from '../types/auth-request.type';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Reflector>;
  let jwtService: jest.Mocked<JwtService>;
  let sessionRepository: jest.Mocked<SessionRepository>;
  let userRepository: jest.Mocked<UserRepository>;
  let context: jest.Mocked<ExecutionContext>;

  const mockUserId = new Types.ObjectId();
  const mockSessionId = new Types.ObjectId();
  const mockRoleId = new Types.ObjectId();

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    jwtService = {
      verifyAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    sessionRepository = {
      findActiveSessionByIdAndUserId: jest.fn(),
    } as unknown as jest.Mocked<SessionRepository>;

    userRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    guard = new JwtAuthGuard(
      reflector,
      jwtService,
      sessionRepository,
      userRepository,
    );

    context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn(),
      }),
    } as unknown as jest.Mocked<ExecutionContext>;
  });

  it('should allow access if route is marked as public', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(
      sessionRepository.findActiveSessionByIdAndUserId,
    ).not.toHaveBeenCalled();
    expect(userRepository.findById).not.toHaveBeenCalled();
  });

  it('should throw UNAUTHORIZED if access token cookie is missing', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue({
      cookies: {},
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
      statusCode: HttpStatus.UNAUTHORIZED,
    });
  });

  it('should validate session and user, and attach roleIds to request.user', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    const mockRequest = {
      cookies: {
        [ACCESS_TOKEN_COOKIE]: 'valid.token.here',
      },
    } as unknown as AuthenticatedRequest;

    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue(
      mockRequest,
    );

    jwtService.verifyAsync.mockResolvedValue({
      sub: mockUserId.toString(),
      sid: mockSessionId.toString(),
      type: 'access',
    });

    sessionRepository.findActiveSessionByIdAndUserId.mockResolvedValue({
      _id: mockSessionId,
      userId: mockUserId,
    } as any);

    userRepository.findById.mockResolvedValue({
      _id: mockUserId,
      status: UserStatus.ACTIVE,
      roleIds: [mockRoleId],
    } as any);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockRequest.user).toBeDefined();
    expect(mockRequest.user.userId).toEqual(mockUserId);
    expect(mockRequest.user.sessionId).toEqual(mockSessionId);
    expect(mockRequest.user.roleIds).toEqual([mockRoleId]);
  });

  it('should attach empty array for roleIds if user has no roleIds', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    const mockRequest = {
      cookies: {
        [ACCESS_TOKEN_COOKIE]: 'valid.token.here',
      },
    } as unknown as AuthenticatedRequest;

    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue(
      mockRequest,
    );

    jwtService.verifyAsync.mockResolvedValue({
      sub: mockUserId.toString(),
      sid: mockSessionId.toString(),
      type: 'access',
    });

    sessionRepository.findActiveSessionByIdAndUserId.mockResolvedValue({
      _id: mockSessionId,
      userId: mockUserId,
    } as any);

    userRepository.findById.mockResolvedValue({
      _id: mockUserId,
      status: UserStatus.ACTIVE,
    } as any);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockRequest.user.roleIds).toEqual([]);
  });

  it('should throw UNAUTHORIZED if user is not active', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    const mockRequest = {
      cookies: {
        [ACCESS_TOKEN_COOKIE]: 'valid.token.here',
      },
    };

    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue(
      mockRequest,
    );

    jwtService.verifyAsync.mockResolvedValue({
      sub: mockUserId.toString(),
      sid: mockSessionId.toString(),
      type: 'access',
    });

    sessionRepository.findActiveSessionByIdAndUserId.mockResolvedValue({
      _id: mockSessionId,
      userId: mockUserId,
    } as any);

    userRepository.findById.mockResolvedValue({
      _id: mockUserId,
      status: UserStatus.INACTIVE,
    } as any);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
      statusCode: HttpStatus.UNAUTHORIZED,
    });
  });

  it('should throw UNAUTHORIZED if session is not active', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    const mockRequest = {
      cookies: {
        [ACCESS_TOKEN_COOKIE]: 'valid.token.here',
      },
    };

    (context.switchToHttp().getRequest as jest.Mock).mockReturnValue(
      mockRequest,
    );

    jwtService.verifyAsync.mockResolvedValue({
      sub: mockUserId.toString(),
      sid: mockSessionId.toString(),
      type: 'access',
    });

    sessionRepository.findActiveSessionByIdAndUserId.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
      statusCode: HttpStatus.UNAUTHORIZED,
    });
  });
});

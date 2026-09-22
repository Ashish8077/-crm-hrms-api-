/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';

import { AuthService } from './auth.service.js';
import { UserRepository } from '../users/repositories/user.repository.js';
import { SessionRepository } from './repositories/session.repository.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { LoginSecurityService } from './services/login-security.service.js';
import { PasswordUtil } from '../../common/utils/password.util.js';
import { UserStatus } from '../users/constants/user-status.constant.js';
import { AppError } from '../../common/errors/app-error.js';
import { ErrorCode } from '../../common/errors/error-codes.js';

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: jest.Mocked<UserRepository>;
  let sessionRepository: jest.Mocked<SessionRepository>;
  let loginSecurityService: jest.Mocked<LoginSecurityService>;
  let auditLogsService: jest.Mocked<AuditLogsService>;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  const clientMetadata = {
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
  };

  const loginDto = {
    email: 'test@example.com',
    password: 'password123',
  };

  const mockUser = {
    _id: new Types.ObjectId(),
    email: 'test@example.com',
    passwordHash: 'hashed_password',
    status: UserStatus.ACTIVE,
  };

  beforeEach(async () => {
    const userRepositoryMock = {
      findByEmail: jest.fn(),
      updateLastLoginAt: jest.fn(),
    };
    const sessionRepositoryMock = {
      createSession: jest.fn(),
    };
    const loginSecurityServiceMock = {
      isLockedOut: jest.fn(),
      incrementFailedAttempts: jest.fn(),
      resetAttempts: jest.fn(),
    };
    const auditLogsServiceMock = {
      recordLoginSuccess: jest.fn(),
      recordLoginFailure: jest.fn(),
      recordRefreshSuccess: jest.fn(),
      recordRefreshFailure: jest.fn(),
      recordLogoutSuccess: jest.fn(),
    };
    const jwtServiceMock = {
      signAsync: jest.fn(),
    };
    const configServiceMock = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'jwt.refreshTokenExpiresIn') return '7d';
        if (key === 'jwt.accessTokenExpiresIn') return '15m';
        throw new Error('Key not found');
      }),
    };

    const dbSessionMock = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
      inTransaction: jest.fn().mockReturnValue(true),
    };

    const connectionMock = {
      startSession: jest.fn().mockResolvedValue(dbSessionMock),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserRepository, useValue: userRepositoryMock },
        { provide: SessionRepository, useValue: sessionRepositoryMock },
        { provide: LoginSecurityService, useValue: loginSecurityServiceMock },
        { provide: AuditLogsService, useValue: auditLogsServiceMock },
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: getConnectionToken(), useValue: connectionMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get(UserRepository);
    sessionRepository = module.get(SessionRepository);
    loginSecurityService = module.get(LoginSecurityService);
    auditLogsService = module.get(AuditLogsService);
    jwtService = module.get(JwtService);
    configService = module.get(ConfigService);

    // Silence logger
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('should successfully log in and return tokens', async () => {
      loginSecurityService.isLockedOut.mockResolvedValue(false);
      userRepository.findByEmail.mockResolvedValue(mockUser as any);
      jest.spyOn(PasswordUtil, 'verify').mockResolvedValue(true);
      sessionRepository.createSession.mockResolvedValue({
        _id: new Types.ObjectId(),
      } as any);
      jwtService.signAsync.mockResolvedValue('access_token');
      userRepository.updateLastLoginAt.mockResolvedValue(undefined);

      const result = await service.login(loginDto, clientMetadata);

      expect(result.accessToken).toBe('access_token');
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBe(900); // 15m
      expect(result.user.email).toBe(mockUser.email);
      expect(result.user.id).toBe(mockUser._id.toString());

      expect(loginSecurityService.resetAttempts).toHaveBeenCalledWith(
        loginDto.email,
      );
      expect(auditLogsService.recordLoginSuccess).toHaveBeenCalledWith(
        mockUser._id,
        loginDto.email,
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
      );
    });

    it('should throw INVALID_CREDENTIALS if user is locked out', async () => {
      loginSecurityService.isLockedOut.mockResolvedValue(true);

      await expect(service.login(loginDto, clientMetadata)).rejects.toThrow(
        new AppError(
          ErrorCode.INVALID_CREDENTIALS,
          'Invalid email or password',
          HttpStatus.UNAUTHORIZED,
        ),
      );

      expect(auditLogsService.recordLoginFailure).toHaveBeenCalledWith(
        loginDto.email,
        'account_locked_out',
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
      );
    });

    it('should throw INVALID_CREDENTIALS and increment attempts if user not found', async () => {
      loginSecurityService.isLockedOut.mockResolvedValue(false);
      userRepository.findByEmail.mockResolvedValue(null);

      await expect(service.login(loginDto, clientMetadata)).rejects.toThrow(
        new AppError(
          ErrorCode.INVALID_CREDENTIALS,
          'Invalid email or password',
          HttpStatus.UNAUTHORIZED,
        ),
      );

      expect(loginSecurityService.incrementFailedAttempts).toHaveBeenCalledWith(
        loginDto.email,
      );
      expect(auditLogsService.recordLoginFailure).toHaveBeenCalledWith(
        loginDto.email,
        'invalid_credentials',
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
      );
    });

    it('should throw INVALID_CREDENTIALS and increment attempts if password invalid', async () => {
      loginSecurityService.isLockedOut.mockResolvedValue(false);
      userRepository.findByEmail.mockResolvedValue(mockUser as any);
      jest.spyOn(PasswordUtil, 'verify').mockResolvedValue(false);

      await expect(service.login(loginDto, clientMetadata)).rejects.toThrow(
        new AppError(
          ErrorCode.INVALID_CREDENTIALS,
          'Invalid email or password',
          HttpStatus.UNAUTHORIZED,
        ),
      );

      expect(loginSecurityService.incrementFailedAttempts).toHaveBeenCalledWith(
        loginDto.email,
      );
      expect(auditLogsService.recordLoginFailure).toHaveBeenCalledWith(
        loginDto.email,
        'invalid_credentials',
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
        mockUser._id,
      );
    });

    it('should throw INVALID_CREDENTIALS if user is inactive', async () => {
      loginSecurityService.isLockedOut.mockResolvedValue(false);
      userRepository.findByEmail.mockResolvedValue({
        ...mockUser,
        status: UserStatus.INACTIVE,
      } as any);

      await expect(service.login(loginDto, clientMetadata)).rejects.toThrow(
        new AppError(
          ErrorCode.INVALID_CREDENTIALS,
          'Invalid email or password',
          HttpStatus.UNAUTHORIZED,
        ),
      );

      expect(auditLogsService.recordLoginFailure).toHaveBeenCalledWith(
        loginDto.email,
        'account_inactive',
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
        mockUser._id,
      );
    });
  });

  describe('refresh', () => {
    const refreshToken = 'valid_token';
    const mockSession = {
      _id: new Types.ObjectId(),
      userId: mockUser._id,
    };

    beforeEach(() => {
      sessionRepository.findValidSessionByRefreshTokenHash = jest.fn();
      sessionRepository.revokeSessionById = jest.fn();
      sessionRepository.revokeSessionAtomically = jest.fn();
      auditLogsService.recordRefreshFailure = jest.fn();
      auditLogsService.recordRefreshSuccess = jest.fn();
    });

    it('should successfully rotate refresh token', async () => {
      sessionRepository.findValidSessionByRefreshTokenHash.mockResolvedValue(
        mockSession as any,
      );
      userRepository.findById.mockResolvedValue(mockUser as any);
      sessionRepository.revokeSessionAtomically.mockResolvedValue(true);
      sessionRepository.createSession.mockResolvedValue({
        _id: new Types.ObjectId(),
      } as any);
      jwtService.signAsync.mockResolvedValue('new_access_token');

      const result = await service.refresh(refreshToken, clientMetadata);

      expect(result.accessToken).toBe('new_access_token');
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBe(900); // 15m
      expect(result.user.email).toBe(mockUser.email);
      expect(result.user.id).toBe(mockUser._id.toString());

      expect(sessionRepository.revokeSessionAtomically).toHaveBeenCalled();
      expect(auditLogsService.recordRefreshSuccess).toHaveBeenCalled();
    });

    it('should fail if token is missing', async () => {
      await expect(service.refresh(undefined, clientMetadata)).rejects.toThrow(
        new AppError(
          ErrorCode.INVALID_REFRESH_TOKEN,
          'Invalid or expired refresh token',
          HttpStatus.UNAUTHORIZED,
        ),
      );
      expect(auditLogsService.recordRefreshFailure).toHaveBeenCalledWith(
        'invalid_refresh_token',
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
      );
    });

    it('should fail if session is invalid', async () => {
      sessionRepository.findValidSessionByRefreshTokenHash.mockResolvedValue(
        null,
      );

      await expect(
        service.refresh(refreshToken, clientMetadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.INVALID_REFRESH_TOKEN,
          'Invalid or expired refresh token',
          HttpStatus.UNAUTHORIZED,
        ),
      );
      expect(auditLogsService.recordRefreshFailure).toHaveBeenCalledWith(
        'invalid_refresh_token',
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
      );
    });

    it('should fail and delete session if user is inactive', async () => {
      sessionRepository.findValidSessionByRefreshTokenHash.mockResolvedValue(
        mockSession as any,
      );
      userRepository.findById.mockResolvedValue({
        ...mockUser,
        status: UserStatus.INACTIVE,
      } as any);

      await expect(
        service.refresh(refreshToken, clientMetadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.INVALID_REFRESH_TOKEN,
          'Invalid or expired refresh token',
          HttpStatus.UNAUTHORIZED,
        ),
      );

      expect(sessionRepository.revokeSessionById).toHaveBeenCalledWith(
        mockSession._id,
      );
      expect(auditLogsService.recordRefreshFailure).toHaveBeenCalledWith(
        'account_inactive',
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
        mockSession.userId,
      );
    });

    it('should fail atomic rotation if token is reused', async () => {
      sessionRepository.findValidSessionByRefreshTokenHash.mockResolvedValue(
        mockSession as any,
      );
      userRepository.findById.mockResolvedValue(mockUser as any);
      sessionRepository.revokeSessionAtomically.mockResolvedValue(false); // Fails atomic check

      await expect(
        service.refresh(refreshToken, clientMetadata),
      ).rejects.toThrow(
        new AppError(
          ErrorCode.INVALID_REFRESH_TOKEN,
          'Invalid or expired refresh token',
          HttpStatus.UNAUTHORIZED,
        ),
      );

      expect(auditLogsService.recordRefreshFailure).toHaveBeenCalledWith(
        'refresh_token_reuse',
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
        mockSession.userId,
      );
    });
  });
});

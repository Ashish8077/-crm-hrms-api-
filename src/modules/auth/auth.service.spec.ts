/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';

import { AuthService } from './auth.service.js';
import { UserRepository } from '../users/repositories/user.repository.js';
import { SessionRepository } from './repositories/session.repository.js';
import { AuditLogRepository } from './repositories/audit-log.repository.js';
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
  let auditLogRepository: jest.Mocked<AuditLogRepository>;
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
    const auditLogRepositoryMock = {
      recordLoginFailure: jest.fn(),
      recordLoginSuccess: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserRepository, useValue: userRepositoryMock },
        { provide: SessionRepository, useValue: sessionRepositoryMock },
        { provide: LoginSecurityService, useValue: loginSecurityServiceMock },
        { provide: AuditLogRepository, useValue: auditLogRepositoryMock },
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get(UserRepository);
    sessionRepository = module.get(SessionRepository);
    loginSecurityService = module.get(LoginSecurityService);
    auditLogRepository = module.get(AuditLogRepository);
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
      expect(auditLogRepository.recordLoginSuccess).toHaveBeenCalledWith(
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

      expect(auditLogRepository.recordLoginFailure).toHaveBeenCalledWith(
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
      expect(auditLogRepository.recordLoginFailure).toHaveBeenCalledWith(
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
      expect(auditLogRepository.recordLoginFailure).toHaveBeenCalledWith(
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

      expect(auditLogRepository.recordLoginFailure).toHaveBeenCalledWith(
        loginDto.email,
        'account_inactive',
        clientMetadata.ipAddress,
        clientMetadata.userAgent,
        mockUser._id,
      );
    });
  });
});

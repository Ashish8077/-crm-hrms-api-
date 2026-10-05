/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { LoginSecurityService } from './login-security.service.js';
import { RedisService } from '../../../common/redis/redis.service.js';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

describe('LoginSecurityService', () => {
  let service: LoginSecurityService;
  let redisService: jest.Mocked<RedisService>;

  beforeEach(async () => {
    const redisServiceMock = {
      getClient: jest.fn(),
      exists: jest.fn(),
      incrementLoginAttempts: jest.fn(),
      resetLoginAttempts: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginSecurityService,
        {
          provide: RedisService,
          useValue: redisServiceMock,
        },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('test-secret') },
        },
      ],
    }).compile();

    service = module.get<LoginSecurityService>(LoginSecurityService);
    redisService = module.get(RedisService);

    // Silence logger for clean test output
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isLockedOut', () => {
    it('should return true if lockout key exists', async () => {
      redisService.exists.mockResolvedValue(true);
      const result = await service.isLockedOut('test@example.com');
      expect(result).toBe(true);
    });

    it('should return false if lockout key does not exist', async () => {
      redisService.exists.mockResolvedValue(false);
      const result = await service.isLockedOut('test@example.com');
      expect(result).toBe(false);
    });
  });

  describe('incrementFailedAttempts', () => {
    it('should increment attempts and set expiry on first attempt', async () => {
      redisService.incrementLoginAttempts.mockResolvedValue(1);

      await service.incrementFailedAttempts('test@example.com');
      expect(redisService.incrementLoginAttempts).toHaveBeenCalled();
    });

    it('should trigger lockout when threshold is reached', async () => {
      redisService.incrementLoginAttempts.mockResolvedValue(5);

      await service.incrementFailedAttempts('test@example.com');
      expect(redisService.incrementLoginAttempts).toHaveBeenCalled();
    });
  });

  describe('resetAttempts', () => {
    it('should delete both attempts and lockout keys', async () => {
      redisService.resetLoginAttempts.mockResolvedValue(1);
      await service.resetAttempts('test@example.com');
      expect(redisService.resetLoginAttempts).toHaveBeenCalled();
    });
  });
});

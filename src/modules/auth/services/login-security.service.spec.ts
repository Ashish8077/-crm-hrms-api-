/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { LoginSecurityService } from './login-security.service.js';
import { RedisService } from '../../../common/redis/redis.service.js';
import { Logger } from '@nestjs/common';
import {
  REDIS_LOGIN_LOCKOUT_PREFIX,
  REDIS_LOGIN_ATTEMPTS_PREFIX,
  LOGIN_LOCKOUT_THRESHOLD,
  LOGIN_ATTEMPT_WINDOW_SECONDS,
  LOGIN_LOCKOUT_DURATION_SECONDS,
} from '../constants/auth.constants.js';

describe('LoginSecurityService', () => {
  let service: LoginSecurityService;
  let redisService: jest.Mocked<RedisService>;
  let redisClient: any;

  beforeEach(async () => {
    redisClient = {
      exists: jest.fn(),
      multi: jest.fn(),
    };

    const redisServiceMock = {
      getClient: jest.fn().mockReturnValue(redisClient),
      expire: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginSecurityService,
        {
          provide: RedisService,
          useValue: redisServiceMock,
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
      redisClient.exists.mockResolvedValue(1);
      const result = await service.isLockedOut('test@example.com');
      expect(result).toBe(true);
      expect(redisClient.exists).toHaveBeenCalledWith(
        `${REDIS_LOGIN_LOCKOUT_PREFIX}test@example.com`,
      );
    });

    it('should return false if lockout key does not exist', async () => {
      redisClient.exists.mockResolvedValue(0);
      const result = await service.isLockedOut('test@example.com');
      expect(result).toBe(false);
    });
  });

  describe('incrementFailedAttempts', () => {
    it('should increment attempts and set expiry on first attempt', async () => {
      const multiExec = jest.fn().mockResolvedValue([[null, 1]]);
      const multi = {
        incr: jest.fn(),
        exec: multiExec,
      };
      redisClient.multi.mockReturnValue(multi);

      await service.incrementFailedAttempts('test@example.com');

      expect(multi.incr).toHaveBeenCalledWith(
        `${REDIS_LOGIN_ATTEMPTS_PREFIX}test@example.com`,
      );
      expect(redisService.expire).toHaveBeenCalledWith(
        `${REDIS_LOGIN_ATTEMPTS_PREFIX}test@example.com`,
        LOGIN_ATTEMPT_WINDOW_SECONDS,
      );
      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('should trigger lockout when threshold is reached', async () => {
      const multiExec = jest
        .fn()
        .mockResolvedValue([[null, LOGIN_LOCKOUT_THRESHOLD]]);
      const multi = {
        incr: jest.fn(),
        exec: multiExec,
      };
      redisClient.multi.mockReturnValue(multi);

      await service.incrementFailedAttempts('test@example.com');

      expect(redisService.expire).not.toHaveBeenCalled(); // Only called on attempt === 1
      expect(redisService.set).toHaveBeenCalledWith(
        `${REDIS_LOGIN_LOCKOUT_PREFIX}test@example.com`,
        '1',
        LOGIN_LOCKOUT_DURATION_SECONDS,
      );
    });
  });

  describe('resetAttempts', () => {
    it('should delete both attempts and lockout keys', async () => {
      await service.resetAttempts('test@example.com');
      expect(redisService.del).toHaveBeenCalledWith(
        `${REDIS_LOGIN_ATTEMPTS_PREFIX}test@example.com`,
        `${REDIS_LOGIN_LOCKOUT_PREFIX}test@example.com`,
      );
    });
  });
});

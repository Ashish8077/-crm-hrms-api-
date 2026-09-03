import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { RedisService } from '../../../common/redis/redis.service.js';
import {
  LOGIN_LOCKOUT_DURATION_SECONDS,
  LOGIN_LOCKOUT_THRESHOLD,
  REDIS_LOGIN_ATTEMPTS_PREFIX,
  REDIS_LOGIN_LOCKOUT_PREFIX,
  LOGIN_ATTEMPT_WINDOW_SECONDS,
} from '../constants/auth.constants.js';

@Injectable()
export class LoginSecurityService {
  private readonly logger = new Logger(LoginSecurityService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * Checks if an email is currently locked out.
   */
  async isLockedOut(email: string): Promise<boolean> {
    try {
      const key = `${REDIS_LOGIN_LOCKOUT_PREFIX}${email}`;
      return await this.redisService.exists(key);
    } catch (error) {
      this.logger.error(`Redis error during isLockedOut: ${String(error)}`);
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Authentication service temporarily unavailable',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Increments the failed attempt counter for an email.
   * If the counter reaches the threshold, sets the lockout flag.
   */
  async incrementFailedAttempts(email: string): Promise<void> {
    const attemptsKey = `${REDIS_LOGIN_ATTEMPTS_PREFIX}${email}`;
    const lockoutKey = `${REDIS_LOGIN_LOCKOUT_PREFIX}${email}`;

    try {
      const attempts = await this.redisService.incrementLoginAttempts(
        attemptsKey,
        lockoutKey,
        LOGIN_ATTEMPT_WINDOW_SECONDS,
        LOGIN_LOCKOUT_THRESHOLD,
        LOGIN_LOCKOUT_DURATION_SECONDS,
      );

      if (attempts >= LOGIN_LOCKOUT_THRESHOLD) {
        this.logger.warn(
          `Account locked due to brute force protection: ${email}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Redis error during incrementFailedAttempts: ${String(error)}`,
      );
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Authentication service temporarily unavailable',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Clears both the attempt counter and lockout flag for an email.
   * Called on a successful login.
   */
  async resetAttempts(email: string): Promise<void> {
    const attemptsKey = `${REDIS_LOGIN_ATTEMPTS_PREFIX}${email}`;
    const lockoutKey = `${REDIS_LOGIN_LOCKOUT_PREFIX}${email}`;

    await this.redisService.del(attemptsKey, lockoutKey);
  }
}

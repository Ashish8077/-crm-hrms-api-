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
import { HmacUtil } from '../../../common/utils/crypto/hmac.util.js';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LoginSecurityService {
  private readonly logger = new Logger(LoginSecurityService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  private getEmailKey(email: string): string {
    const secret = this.configService.getOrThrow<string>('redis.keyHmacSecret');
    return HmacUtil.hash(email, secret);
  }

  /**
   * Checks if an email is currently locked out.
   */
  async isLockedOut(email: string): Promise<boolean> {
    try {
      const emailKey = this.getEmailKey(email);
      return await this.redisService.exists(
        `${REDIS_LOGIN_LOCKOUT_PREFIX}${emailKey}`,
      );
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
    const emailKey = this.getEmailKey(email);
    const attemptsKey = `${REDIS_LOGIN_ATTEMPTS_PREFIX}${emailKey}`;
    const lockoutKey = `${REDIS_LOGIN_LOCKOUT_PREFIX}${emailKey}`;

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
    const emailKey = this.getEmailKey(email);
    const attemptsKey = `${REDIS_LOGIN_ATTEMPTS_PREFIX}${emailKey}`;
    const lockoutKey = `${REDIS_LOGIN_LOCKOUT_PREFIX}${emailKey}`;

    await this.redisService.resetLoginAttempts(attemptsKey, lockoutKey);
  }
}

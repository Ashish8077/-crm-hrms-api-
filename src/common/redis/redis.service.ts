import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.getOrThrow<string>('redis.url');

    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number): number | null {
        if (times > 10) return null; // stop retrying after 10 attempts
        return Math.min(times * 200, 5000);
      },
      enableReadyCheck: true,
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connection established');
    });

    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis connection error: ${error.message}`);
    });

    this.client.on('reconnecting', (delay: number) => {
      this.logger.warn(`Redis reconnecting in ${delay}ms`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('Redis client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.log('Redis client disconnected');
  }

  // ──────────────────────────────────────────────
  // Core primitives
  // ──────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<'OK' | null> {
    if (ttlSeconds !== undefined) {
      return this.client.set(key, value, 'EX', ttlSeconds);
    }
    return this.client.set(key, value);
  }

  async del(...keys: string[]): Promise<number> {
    return this.client.del(...keys);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    return this.client.expire(key, ttlSeconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Checks if a key exists in Redis.
   */
  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  /**
   * Atomically increments login attempts and handles TTL + lockout.
   */
  async incrementLoginAttempts(
    attemptsKey: string,
    lockoutKey: string,
    windowSeconds: number,
    threshold: number,
    lockoutDurationSeconds: number,
  ): Promise<number> {
    const script = `
      local attemptsKey = KEYS[1]
      local lockoutKey = KEYS[2]
      local window = tonumber(ARGV[1])
      local threshold = tonumber(ARGV[2])
      local lockoutDuration = tonumber(ARGV[3])

      local currentAttempts = redis.call("INCR", attemptsKey)

      if currentAttempts == 1 then
        redis.call("EXPIRE", attemptsKey, window)
      end

      if currentAttempts >= threshold then
        redis.call("SET", lockoutKey, "1", "EX", lockoutDuration)
      end

      return currentAttempts
    `;

    const result = await this.client.eval(
      script,
      2,
      attemptsKey,
      lockoutKey,
      windowSeconds,
      threshold,
      lockoutDurationSeconds,
    );
    return result as number;
  }

  /**
   * Returns the underlying ioredis client for advanced operations
   * (e.g., pipelines, multi/exec, Lua scripts).
   * Prefer the typed methods above for standard operations.
   */
  getClient(): Redis {
    return this.client;
  }
}

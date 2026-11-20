import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../common/redis/redis.service';

@Injectable()
export class DashboardCacheService {
  private readonly logger = new Logger(DashboardCacheService.name);
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly redisService: RedisService) {}

  /**
   * Retrieves an item from Redis or executes fetcher with stampede guard and fail-open resilience.
   */
  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    // 1. Attempt Redis Read
    try {
      const cached = await this.redisService.get(key);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    } catch (error) {
      this.logger.warn(`Redis get failed for key "${key}": ${(error as Error).message}. Proceeding to DB.`);
    }

    // 2. In-flight stampede protection
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key) as Promise<T>;
    }

    // 3. Execute fetcher
    const promise = (async () => {
      try {
        const result = await fetcher();

        // Asynchronously set cache (fail-open)
        this.redisService
          .set(key, JSON.stringify(result), ttlSeconds)
          .catch((err: Error) => {
            this.logger.warn(`Redis set failed for key "${key}": ${err.message}`);
          });

        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Invalidates a cache key.
   */
  async del(key: string): Promise<void> {
    try {
      await this.redisService.del(key);
    } catch (error) {
      this.logger.warn(`Redis del failed for key "${key}": ${(error as Error).message}`);
    }
  }
}


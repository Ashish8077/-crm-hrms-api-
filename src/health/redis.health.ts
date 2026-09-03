import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { RedisService } from '../common/redis/redis.service.js';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly redisService: RedisService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const client = this.redisService.getClient();
      const result = await client.ping();
      if (result === 'PONG') {
        return this.healthIndicatorService.check(key).up();
      }
      return this.healthIndicatorService
        .check(key)
        .down({ message: 'Redis ping did not return PONG' });
    } catch (error) {
      const e = error as Error;
      return this.healthIndicatorService
        .check(key)
        .down({ message: e.message });
    }
  }
}

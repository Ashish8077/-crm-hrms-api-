import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { TerminusModule } from '@nestjs/terminus';
import { RedisModule } from '../common/redis/redis.module.js';
import { RedisHealthIndicator } from './redis.health.js';

@Module({
  imports: [TerminusModule, RedisModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}

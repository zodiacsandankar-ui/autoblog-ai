import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CacheService } from './cache.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL', 'redis://localhost:6379');
        const url = new URL(redisUrl);

        return new Redis({
          host: url.hostname,
          port: parseInt(url.port || '6379'),
          password: url.password || undefined,
          db: parseInt(url.pathname?.slice(1) || '0'),
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            if (times > 10) return null; // stop retrying
            return delay;
          },
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
          connectTimeout: 10000,
        });
      },
      inject: [ConfigService],
    },
    CacheService,
  ],
  exports: ['REDIS_CLIENT', CacheService],
})
export class CacheModule {}

import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../database/database.module';
import { AiModule as DeepSeekModule } from '../../ai/ai.module';
import { TrendsController } from './trends.controller';
import { TrendDiscoveryService } from './trend-discovery.service';

@Module({
  imports: [
    PrismaModule,
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
    CacheModule.register({
      ttl: 60 * 60, // 1 hour cache
      max: 1000,
    }),
    BullModule.registerQueue({
      name: 'trends',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }),
    DeepSeekModule,
  ],
  controllers: [TrendsController],
  providers: [TrendDiscoveryService],
  exports: [TrendDiscoveryService],
})
export class TrendsModule {}

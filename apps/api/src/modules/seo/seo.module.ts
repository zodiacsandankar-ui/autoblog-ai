import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaModule } from '../../database/database.module';
import { AiModule as DeepSeekModule } from '../../ai/ai.module';
import { SeoController } from './seo.controller';
import { SeoOptimizerService } from './seo-optimizer.service';

@Module({
  imports: [
    PrismaModule,
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
    CacheModule.register({
      ttl: 60 * 60,
      max: 500,
    }),
    DeepSeekModule,
  ],
  controllers: [SeoController],
  providers: [SeoOptimizerService],
  exports: [SeoOptimizerService],
})
export class SeoModule {}

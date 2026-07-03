import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../../database/database.module';
import { AiModule as DeepSeekModule } from '../../ai/ai.module';
import { KeywordsController } from './keywords.controller';
import { KeywordIntelligenceService } from './keyword-intelligence.service';

@Module({
  imports: [
    PrismaModule,
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
    CacheModule.register({
      ttl: 60 * 60 * 24, // 24 hour cache
      max: 5000,
    }),
    DeepSeekModule,
  ],
  controllers: [KeywordsController],
  providers: [KeywordIntelligenceService],
  exports: [KeywordIntelligenceService],
})
export class KeywordsModule {}

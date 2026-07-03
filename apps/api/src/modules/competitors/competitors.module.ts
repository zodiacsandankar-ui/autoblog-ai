import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../../database/database.module';
import { AiModule as DeepSeekModule } from '../../ai/ai.module';
import { CompetitorsController } from './competitors.controller';
import { CompetitorResearchService } from './competitor-research.service';

@Module({
  imports: [
    PrismaModule,
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
    DeepSeekModule,
  ],
  controllers: [CompetitorsController],
  providers: [CompetitorResearchService],
  exports: [CompetitorResearchService],
})
export class CompetitorsModule {}

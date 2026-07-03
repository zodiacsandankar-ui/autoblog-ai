import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../database/database.module';
import { AiModule as DeepSeekModule } from '../../ai/ai.module';
import { ImagesModule } from '../images/images.module';
import { SeoModule } from '../seo/seo.module';
import { ArticlesController } from './articles.controller';
import { BlogGeneratorService } from './blog-generator.service';
import { ArticleVersionService } from './article-version.service';

@Module({
  imports: [
    PrismaModule,
    HttpModule.register({
      timeout: 60000,
      maxRedirects: 5,
    }),
    CacheModule.register({
      ttl: 60 * 5,
      max: 500,
    }),
    BullModule.registerQueue({
      name: 'articles',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }),
    DeepSeekModule,
    ImagesModule,
    SeoModule,
  ],
  controllers: [ArticlesController],
  providers: [BlogGeneratorService, ArticleVersionService],
  exports: [BlogGeneratorService, ArticleVersionService],
})
export class ArticlesModule {}

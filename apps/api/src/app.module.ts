import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { StorageModule } from './storage/storage.module';
import { SearchModule } from './search/search.module';
import { QueueModule } from './queue/queue.module';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AiModule } from './modules/ai/ai.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TrendsModule } from './modules/trends/trends.module';
import { KeywordsModule } from './modules/keywords/keywords.module';
import { CompetitorsModule } from './modules/competitors/competitors.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { ImagesModule } from './modules/images/images.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { PublishingModule } from './modules/publishing/publishing.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SeoModule } from './modules/seo/seo.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { BillingModule } from './modules/billing/billing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PluginsModule } from './modules/plugins/plugins.module';
import { WebsitesModule } from './modules/websites/websites.module';

// Common
import { HealthController } from './common/controllers/health.controller';
import { MetricsController } from './common/controllers/metrics.controller';
import { PrometheusService } from './common/metrics/prometheus.service';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
      expandVariables: true,
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('THROTTLE_TTL', 60000),
            limit: config.get<number>('THROTTLE_LIMIT', 100),
          },
        ],
      }),
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // Queue (BullMQ with Redis)
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: new URL(config.get<string>('REDIS_URL') || 'redis://localhost:6379').hostname,
          port: parseInt(new URL(config.get<string>('REDIS_URL') || 'redis://localhost:6379').port || '6379'),
          password: new URL(config.get<string>('REDIS_URL') || 'redis://localhost:6379').password || undefined,
        },
      }),
    }),

    // Logging
    WinstonModule.forRoot({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
              return `${timestamp} [${context || 'Application'}] ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
            }),
          ),
        }),
      ],
    }),

    // Infrastructure
    DatabaseModule,
    CacheModule,
    StorageModule,
    SearchModule,
    QueueModule,

    // Feature modules
    AuthModule,
    UsersModule,
    OrganizationsModule,
    AiModule,
    ProjectsModule,
    TrendsModule,
    KeywordsModule,
    CompetitorsModule,
    ArticlesModule,
    ImagesModule,
    SchedulerModule,
    PublishingModule,
    AnalyticsModule,
    SeoModule,
    WorkflowsModule,
    BillingModule,
    NotificationsModule,
    PluginsModule,
    WebsitesModule,
  ],
  controllers: [HealthController, MetricsController],
  providers: [
    PrometheusService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { PrometheusService } from './common/metrics/prometheus.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');
  const port = configService.get<number>('PORT', 3001);

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  app.use(cookieParser());

  // CORS
  app.enableCors({
    origin: configService.get<string>('CORS_ORIGINS', 'http://localhost:3000').split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global filters & interceptors
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new TransformInterceptor(),
    new LoggingInterceptor(),
  );

  // Global prefix (disabled in dev for nginx proxy)
  app.setGlobalPrefix('api', { exclude: ['health', 'metrics'] });

  // Swagger documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('AutoBlog AI API')
    .setDescription('Enterprise-Grade AI Autonomous Blogging SaaS Platform')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .addServer('http://localhost:3001', 'Development')
    .addTag('Auth', 'Authentication & Authorization')
    .addTag('AI', 'AI Provider Orchestration')
    .addTag('Projects', 'Project Management')
    .addTag('Trends', 'Trend Discovery Engine')
    .addTag('Keywords', 'Keyword Intelligence')
    .addTag('Competitors', 'Competitor Research')
    .addTag('Articles', 'AI Blog Generator')
    .addTag('Images', 'Image Generator')
    .addTag('Scheduler', 'Content Calendar & Scheduler')
    .addTag('Publishing', 'Publishing Engine')
    .addTag('Analytics', 'Analytics & Reporting')
    .addTag('SEO', 'SEO Engine')
    .addTag('Workflows', 'Automation Workflows')
    .addTag('Billing', 'Subscription & Billing')
    .addTag('Websites', 'Website Builder & Hosting')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  // Prometheus metrics
  const prometheusService = app.get(PrometheusService);

  // Start server
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 AutoBlog AI API running on http://localhost:${port}`);
  logger.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
  logger.log(`📊 Metrics: http://localhost:${port}/metrics`);
  logger.log(`❤️  Health: http://localhost:${port}/health`);
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap application:', error);
  process.exit(1);
});

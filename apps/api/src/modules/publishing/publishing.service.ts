import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../../database/prisma.service';
import { PlatformHandlerInterface, PlatformConfig, PublishResult } from './platforms/platform-handler.interface';
import { WordPressHandler } from './platforms/wordpress.handler';
import { GhostHandler } from './platforms/ghost.handler';
import { ShopifyHandler } from './platforms/shopify.handler';
import { MediumHandler } from './platforms/medium.handler';
import { BloggerHandler } from './platforms/blogger.handler';
import { WebhookHandler } from './platforms/webhook.handler';
import { RestApiHandler } from './platforms/rest-api.handler';
import { GraphqlHandler } from './platforms/graphql.handler';

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);
  private readonly handlers: Map<string, PlatformHandlerInterface>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    @InjectQueue('publishing') private publishingQueue: Queue,
    wordPressHandler: WordPressHandler,
    ghostHandler: GhostHandler,
    shopifyHandler: ShopifyHandler,
    mediumHandler: MediumHandler,
    bloggerHandler: BloggerHandler,
    webhookHandler: WebhookHandler,
    restApiHandler: RestApiHandler,
    graphqlHandler: GraphqlHandler,
  ) {
    this.handlers = new Map();
    const handlerList = [
      wordPressHandler, ghostHandler, shopifyHandler,
      mediumHandler, bloggerHandler, webhookHandler,
      restApiHandler, graphqlHandler,
    ];
    for (const handler of handlerList) {
      this.handlers.set(handler.platform, handler);
    }
  }

  async publish(articleId: string, platforms?: string[]): Promise<PublishResult[]> {
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
      include: { project: true },
    });
    if (!article) throw new NotFoundException(`Article ${articleId} not found`);

    const project = article.project || await this.prisma.project.findUnique({
      where: { id: article.projectId },
    });

    const projectConfig = (project?.config as Record<string, any>)?.publishing || {};
    const platformsToPublish = platforms || Object.keys(projectConfig).filter((k) => projectConfig[k]?.enabled);

    if (platformsToPublish.length === 0) {
      throw new BadRequestException('No publishing platforms configured');
    }

    const results: PublishResult[] = [];

    for (const platform of platformsToPublish) {
      const handler = this.handlers.get(platform);
      if (!handler) {
        results.push({
          success: false,
          platform,
          error: `Unknown platform: ${platform}`,
          publishedAt: new Date(),
        });
        continue;
      }

      const config: PlatformConfig = projectConfig[platform] || {};
      const job = await this.publishingQueue.add('publish', {
        articleId,
        platform,
        config,
      });

      const result = await this.publishWithRetry(handler, article, config);
      results.push(result);

      await this.prisma.publishLog.create({
        data: {
          articleId,
          platform,
          success: result.success,
          url: result.url || null,
          postId: result.postId || null,
          error: result.error || null,
          publishedAt: result.publishedAt,
          projectId: article.projectId,
        },
      });

      if (result.success) {
        await this.prisma.article.update({
          where: { id: articleId },
          data: {
            status: 'published',
            publishedAt: result.publishedAt,
          },
        });
      }
    }

    return results;
  }

  async crossPost(articleId: string, platforms: string[]): Promise<PublishResult[]> {
    const article = await this.prisma.article.findUnique({ where: { id: articleId } });
    if (!article) throw new NotFoundException(`Article ${articleId} not found`);

    const project = await this.prisma.project.findUnique({
      where: { id: article.projectId },
    });
    const projectConfig = (project?.config as Record<string, any>)?.publishing || {};

    const results: PublishResult[] = [];

    for (const platform of platforms) {
      const handler = this.handlers.get(platform);
      if (!handler) {
        results.push({ success: false, platform, error: `Unknown platform: ${platform}`, publishedAt: new Date() });
        continue;
      }

      const config: PlatformConfig = projectConfig[platform] || {};
      const result = await this.publishWithRetry(handler, article, config);
      results.push(result);

      await this.prisma.publishLog.create({
        data: {
          articleId,
          platform,
          success: result.success,
          url: result.url || null,
          postId: result.postId || null,
          error: result.error || null,
          publishedAt: result.publishedAt,
          projectId: article.projectId,
        },
      });
    }

    return results;
  }

  private async publishWithRetry(
    handler: PlatformHandlerInterface,
    article: any,
    config: PlatformConfig,
    maxRetries: number = 5,
  ): Promise<PublishResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        this.logger.log(`Publishing to ${handler.platform}, attempt ${attempt + 1}/${maxRetries}`);
        const result = await handler.publish(article, config);

        if (result.success) {
          return result;
        }

        lastError = result.error;
      } catch (error) {
        lastError = error.message;
        this.logger.warn(`Publish attempt ${attempt + 1} failed for ${handler.platform}: ${error.message}`);
      }

      if (attempt < maxRetries - 1) {
        const delay = this.calculateRetryDelay(attempt);
        this.logger.log(`Waiting ${delay}ms before retry ${attempt + 2}`);
        await this.sleep(delay);
      }
    }

    return {
      success: false,
      platform: handler.platform,
      error: lastError || 'Max retries exceeded',
      publishedAt: new Date(),
    };
  }

  private calculateRetryDelay(attempt: number): number {
    const baseDelay = 1000;
    const maxDelay = 30000;
    const exponentialDelay = Math.pow(2, attempt) * baseDelay;
    const jitter = Math.random() * 1000;
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  async getPublishHistory(filter: {
    page: number;
    limit: number;
    articleId?: string;
    projectId?: string;
    platform?: string;
    success?: boolean;
  }): Promise<any> {
    const where: any = {};
    if (filter.articleId) where.articleId = filter.articleId;
    if (filter.projectId) where.projectId = filter.projectId;
    if (filter.platform) where.platform = filter.platform;
    if (filter.success !== undefined) where.success = filter.success;

    const [data, total] = await Promise.all([
      this.prisma.publishLog.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: { article: { select: { id: true, title: true, slug: true } } },
      }),
      this.prisma.publishLog.count({ where }),
    ]);

    return { data, total, page: filter.page, limit: filter.limit };
  }

  async getPlatforms(): Promise<any[]> {
    const platforms: any[] = [];
    for (const [key, handler] of this.handlers) {
      platforms.push({
        id: key,
        name: handler.name,
        platform: handler.platform,
        configurable: true,
      });
    }
    return platforms;
  }

  getHandler(platform: string): PlatformHandlerInterface | undefined {
    return this.handlers.get(platform);
  }

  getAllHandlers(): Map<string, PlatformHandlerInterface> {
    return new Map(this.handlers);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

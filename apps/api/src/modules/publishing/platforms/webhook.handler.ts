import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  PlatformHandlerInterface,
  PlatformConfig,
  TransformResult,
  PublishResult,
} from './platform-handler.interface';

@Injectable()
export class WebhookHandler implements PlatformHandlerInterface {
  readonly platform = 'webhook';
  readonly name = 'Custom Webhook';
  private readonly logger = new Logger(WebhookHandler.name);

  constructor(private readonly httpService: HttpService) {}

  transform(article: any, config: PlatformConfig): TransformResult {
    return {
      title: article.title,
      content: article.content || '',
      excerpt: article.excerpt || article.metaDescription || '',
      slug: article.slug || '',
      tags: Array.isArray(article.tags) ? article.tags : [],
      featuredImage: article.featuredImage || undefined,
      metaTitle: article.metaTitle || '',
      metaDescription: article.metaDescription || '',
      customFields: {
        author: config.additionalConfig?.author || 'AutoBlog AI',
        createdAt: article.createdAt?.toISOString() || new Date().toISOString(),
        source: 'autoblog-ai',
      },
    };
  }

  async publish(article: any, config: PlatformConfig): Promise<PublishResult> {
    try {
      const webhookUrl = config.webhookUrl || config.apiUrl || process.env.WEBHOOK_URL;

      if (!webhookUrl) {
        return {
          success: false,
          platform: this.platform,
          error: 'Webhook URL not configured',
          publishedAt: new Date(),
        };
      }

      const transformed = this.transform(article, config);

      const headers: Record<string, string> = {
        'Content-Type': config.additionalConfig?.contentType || 'application/json',
        'User-Agent': 'AutoBlog-AI/1.0',
      };

      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }

      if (config.additionalConfig?.customHeaders) {
        Object.assign(headers, config.additionalConfig.customHeaders);
      }

      const payload: Record<string, any> = {
        event: 'article.published',
        timestamp: new Date().toISOString(),
        data: {
          title: transformed.title,
          content: transformed.content,
          excerpt: transformed.excerpt,
          slug: transformed.slug,
          tags: transformed.tags,
          featuredImage: transformed.featuredImage,
          meta: {
            title: transformed.metaTitle,
            description: transformed.metaDescription,
          },
          customFields: transformed.customFields,
        },
      };

      if (config.additionalConfig?.payloadTemplate) {
        const template = config.additionalConfig.payloadTemplate;
        for (const [key, value] of Object.entries(payload.data)) {
          if (template.includes(`{{${key}}}`)) {
            payload[key] = value;
          }
        }
      }

      const response = await firstValueFrom(
        this.httpService.post(webhookUrl, payload, {
          headers,
          timeout: 30000,
        }),
      );

      return {
        success: response.status >= 200 && response.status < 300,
        platform: this.platform,
        postId: response.data?.id || response.data?.postId || `webhook-${Date.now()}`,
        url: webhookUrl,
        publishedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`Webhook publish failed: ${error.message}`);
      return {
        success: false,
        platform: this.platform,
        error: error.message,
        publishedAt: new Date(),
      };
    }
  }

  validate(config: PlatformConfig): boolean {
    return !!(config.webhookUrl || config.apiUrl || process.env.WEBHOOK_URL);
  }

  async test(config: PlatformConfig): Promise<boolean> {
    try {
      const webhookUrl = config.webhookUrl || config.apiUrl || process.env.WEBHOOK_URL;
      if (!webhookUrl) return false;
      await firstValueFrom(
        this.httpService.post(webhookUrl, { event: 'test', timestamp: new Date().toISOString() }, { timeout: 10000 }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

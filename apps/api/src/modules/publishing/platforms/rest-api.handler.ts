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
export class RestApiHandler implements PlatformHandlerInterface {
  readonly platform = 'rest-api';
  readonly name = 'Generic REST API';
  private readonly logger = new Logger(RestApiHandler.name);

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
    };
  }

  async publish(article: any, config: PlatformConfig): Promise<PublishResult> {
    try {
      const apiUrl = config.apiUrl || process.env.REST_API_URL;
      const apiKey = config.apiKey || process.env.REST_API_KEY;

      if (!apiUrl) {
        return {
          success: false,
          platform: this.platform,
          error: 'REST API URL not configured',
          publishedAt: new Date(),
        };
      }

      const transformed = this.transform(article, config);
      const method = (config.additionalConfig?.method || 'POST').toUpperCase();
      const endpoint = config.additionalConfig?.endpoint || '';
      const url = endpoint ? `${apiUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}` : apiUrl;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'AutoBlog-AI/1.0',
      };

      if (apiKey) {
        const authHeader = config.additionalConfig?.authHeader || 'Authorization';
        const authPrefix = config.additionalConfig?.authPrefix || 'Bearer';
        headers[authHeader] = `${authPrefix} ${apiKey}`;
      }

      if (config.additionalConfig?.customHeaders) {
        Object.assign(headers, config.additionalConfig.customHeaders);
      }

      const bodyMapping = config.additionalConfig?.bodyMapping || {};
      const payload: Record<string, any> = {};

      if (bodyMapping.title) payload[bodyMapping.title] = transformed.title;
      else payload.title = transformed.title;

      if (bodyMapping.content) payload[bodyMapping.content] = transformed.content;
      else payload.content = transformed.content;

      if (transformed.excerpt) {
        const key = bodyMapping.excerpt || 'excerpt';
        payload[key] = transformed.excerpt;
      }

      if (transformed.tags?.length) {
        const key = bodyMapping.tags || 'tags';
        payload[key] = transformed.tags;
      }

      if (transformed.featuredImage) {
        const key = bodyMapping.featuredImage || 'featured_image';
        payload[key] = transformed.featuredImage;
      }

      payload.slug = transformed.slug;
      payload.status = 'publish';

      const response = await firstValueFrom(
        this.httpService.request({
          method,
          url,
          data: payload,
          headers,
          timeout: 30000,
        }),
      );

      const idField = config.additionalConfig?.idField || 'id';
      const urlField = config.additionalConfig?.urlField || 'url';

      return {
        success: response.status >= 200 && response.status < 300,
        platform: this.platform,
        postId: String(response.data?.[idField] || ''),
        url: response.data?.[urlField] || url,
        publishedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`REST API publish failed: ${error.message}`);
      return {
        success: false,
        platform: this.platform,
        error: error.response?.data?.message || error.message,
        publishedAt: new Date(),
      };
    }
  }

  validate(config: PlatformConfig): boolean {
    return !!(config.apiUrl || process.env.REST_API_URL);
  }

  async test(config: PlatformConfig): Promise<boolean> {
    try {
      const apiUrl = config.apiUrl || process.env.REST_API_URL;
      if (!apiUrl) return false;
      await firstValueFrom(
        this.httpService.get(apiUrl, {
          headers: { 'User-Agent': 'AutoBlog-AI/1.0' },
          timeout: 10000,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

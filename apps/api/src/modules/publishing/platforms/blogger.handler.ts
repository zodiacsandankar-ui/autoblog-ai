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
export class BloggerHandler implements PlatformHandlerInterface {
  readonly platform = 'blogger';
  readonly name = 'Blogger';
  private readonly logger = new Logger(BloggerHandler.name);

  constructor(private readonly httpService: HttpService) {}

  transform(article: any, config: PlatformConfig): TransformResult {
    return {
      title: article.title,
      content: this.toBloggerFormat(article.content || ''),
      excerpt: (article.excerpt || article.metaDescription || '').substring(0, 200),
      slug: article.slug || '',
      tags: Array.isArray(article.tags) ? article.tags : [],
      featuredImage: article.featuredImage || undefined,
      metaTitle: article.metaTitle || '',
      metaDescription: article.metaDescription || '',
    };
  }

  async publish(article: any, config: PlatformConfig): Promise<PublishResult> {
    try {
      const blogId = config.apiUrl || process.env.BLOGGER_BLOG_ID;
      const apiKey = config.apiKey || process.env.BLOGGER_API_KEY;
      const accessToken = config.apiSecret || process.env.BLOGGER_ACCESS_TOKEN;

      if (!blogId || (!apiKey && !accessToken)) {
        return {
          success: false,
          platform: this.platform,
          error: 'Blogger credentials not configured',
          publishedAt: new Date(),
        };
      }

      const transformed = this.transform(article, config);

      const baseUrl = `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts`;
      const authParam = accessToken
        ? `access_token=${accessToken}`
        : `key=${apiKey}`;

      const postData: Record<string, any> = {
        kind: 'blogger#post',
        title: transformed.title,
        content: transformed.content,
        labels: transformed.tags,
        status: 'LIVE',
      };

      const response = await firstValueFrom(
        this.httpService.post(`${baseUrl}?${authParam}`, postData, {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }),
      );

      return {
        success: true,
        platform: this.platform,
        url: response.data?.url,
        postId: response.data?.id,
        publishedAt: new Date(response.data?.published || new Date()),
      };
    } catch (error) {
      this.logger.error(`Blogger publish failed: ${error.message}`);
      return {
        success: false,
        platform: this.platform,
        error: error.response?.data?.error?.message || error.message,
        publishedAt: new Date(),
      };
    }
  }

  private toBloggerFormat(content: string): string {
    if (!content) return '';
    if (content.startsWith('<')) return content;
    return `<div class="autoblog-content">${content
      .split('\n\n')
      .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
      .join('\n')}</div>`;
  }

  validate(config: PlatformConfig): boolean {
    return !!(config.apiUrl || process.env.BLOGGER_BLOG_ID);
  }

  async test(config: PlatformConfig): Promise<boolean> {
    try {
      const blogId = config.apiUrl || process.env.BLOGGER_BLOG_ID;
      const apiKey = config.apiKey || process.env.BLOGGER_API_KEY;
      if (!blogId) return false;
      await firstValueFrom(
        this.httpService.get(
          `https://www.googleapis.com/blogger/v3/blogs/${blogId}?key=${apiKey || ''}`,
          { timeout: 10000 },
        ),
      );
      return true;
    } catch {
      return false;
    }
  }
}

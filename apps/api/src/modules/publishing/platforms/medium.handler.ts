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
export class MediumHandler implements PlatformHandlerInterface {
  readonly platform = 'medium';
  readonly name = 'Medium';
  private readonly logger = new Logger(MediumHandler.name);

  constructor(private readonly httpService: HttpService) {}

  transform(article: any, config: PlatformConfig): TransformResult {
    return {
      title: article.title,
      content: this.toMediumMarkdown(article.content || ''),
      excerpt: (article.excerpt || article.metaDescription || '').substring(0, 140),
      slug: article.slug || '',
      tags: (Array.isArray(article.tags) ? article.tags : []).slice(0, 5),
      featuredImage: article.featuredImage || undefined,
      metaTitle: article.metaTitle || '',
      metaDescription: article.metaDescription || '',
    };
  }

  async publish(article: any, config: PlatformConfig): Promise<PublishResult> {
    try {
      const apiKey = config.apiKey || process.env.MEDIUM_API_TOKEN;
      if (!apiKey) {
        return {
          success: false,
          platform: this.platform,
          error: 'Medium API token not configured',
          publishedAt: new Date(),
        };
      }

      const transformed = this.transform(article, config);

      const userResponse = await firstValueFrom(
        this.httpService.get('https://api.medium.com/v1/me', {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          timeout: 10000,
        }),
      );

      const userId = userResponse.data?.data?.id;
      if (!userId) throw new Error('Could not get Medium user ID');

      const publicationId = config.additionalConfig?.publicationId;

      const postData: Record<string, any> = {
        title: transformed.title,
        contentFormat: 'markdown',
        content: transformed.content,
        tags: transformed.tags,
        publishStatus: 'public',
        notifyFollowers: true,
      };

      if (transformed.featuredImage) {
        postData.license = 'all-rights-reserved';
      }

      let response;
      if (publicationId) {
        response = await firstValueFrom(
          this.httpService.post(
            `https://api.medium.com/v1/publications/${publicationId}/posts`,
            postData,
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              timeout: 30000,
            },
          ),
        );
      } else {
        response = await firstValueFrom(
          this.httpService.post(
            `https://api.medium.com/v1/users/${userId}/posts`,
            postData,
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              timeout: 30000,
            },
          ),
        );
      }

      const post = response.data?.data;
      return {
        success: true,
        platform: this.platform,
        url: post?.url,
        postId: post?.id,
        publishedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`Medium publish failed: ${error.message}`);
      return {
        success: false,
        platform: this.platform,
        error: error.response?.data?.errors?.[0]?.message || error.message,
        publishedAt: new Date(),
      };
    }
  }

  private toMediumMarkdown(html: string): string {
    if (!html) return '';
    if (!html.includes('<')) return html;
    return html
      .replace(/<h1[^>]*>/gi, '# ')
      .replace(/<h2[^>]*>/gi, '## ')
      .replace(/<h3[^>]*>/gi, '### ')
      .replace(/<h4[^>]*>/gi, '#### ')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<strong[^>]*>/gi, '**')
      .replace(/<\/strong>/gi, '**')
      .replace(/<em[^>]*>/gi, '*')
      .replace(/<\/em>/gi, '*')
      .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi, '[$2]($1)')
      .replace(/<img[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, '![$2]($1)')
      .replace(/<img[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, '![]($1)')
      .replace(/<ul[^>]*>/gi, '')
      .replace(/<\/ul>/gi, '')
      .replace(/<ol[^>]*>/gi, '')
      .replace(/<\/ol>/gi, '')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  validate(config: PlatformConfig): boolean {
    return !!(config.apiKey || process.env.MEDIUM_API_TOKEN);
  }

  async test(config: PlatformConfig): Promise<boolean> {
    try {
      const apiKey = config.apiKey || process.env.MEDIUM_API_TOKEN;
      if (!apiKey) return false;
      await firstValueFrom(
        this.httpService.get('https://api.medium.com/v1/me', {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

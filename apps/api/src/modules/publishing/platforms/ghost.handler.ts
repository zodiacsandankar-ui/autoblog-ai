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
export class GhostHandler implements PlatformHandlerInterface {
  readonly platform = 'ghost';
  readonly name = 'Ghost';
  private readonly logger = new Logger(GhostHandler.name);

  constructor(private readonly httpService: HttpService) {}

  transform(article: any, config: PlatformConfig): TransformResult {
    return {
      title: article.metaTitle || article.title,
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
      const apiUrl = config.apiUrl || process.env.GHOST_API_URL;
      const adminApiKey = config.apiKey || process.env.GHOST_ADMIN_API_KEY;

      if (!apiUrl || !adminApiKey) {
        return {
          success: false,
          platform: this.platform,
          error: 'Ghost API credentials not configured',
          publishedAt: new Date(),
        };
      }

      const token = this.generateGhostToken(adminApiKey);
      const transformed = this.transform(article, config);

      const response = await firstValueFrom(
        this.httpService.post(
          `${apiUrl}/ghost/api/admin/posts/`,
          {
            posts: [
              {
                title: transformed.title,
                html: transformed.content,
                excerpt: transformed.excerpt,
                slug: transformed.slug,
                status: 'published',
                feature_image: transformed.featuredImage,
                meta_title: transformed.metaTitle,
                meta_description: transformed.metaDescription,
                tags: transformed.tags.map((t) => ({ name: t })),
                visibility: 'public',
                published_at: new Date().toISOString(),
              },
            ],
          },
          {
            headers: {
              Authorization: `Ghost ${token}`,
              'Content-Type': 'application/json',
              'Accept-Version': 'v5',
            },
            timeout: 30000,
          },
        ),
      );

      const post = response.data?.posts?.[0];
      return {
        success: true,
        platform: this.platform,
        url: post?.url,
        postId: post?.id,
        publishedAt: new Date(post?.published_at || new Date()),
      };
    } catch (error) {
      this.logger.error(`Ghost publish failed: ${error.message}`);
      return {
        success: false,
        platform: this.platform,
        error: error.response?.data?.errors?.[0]?.message || error.message,
        publishedAt: new Date(),
      };
    }
  }

  private generateGhostToken(adminApiKey: string): string {
    const [id, secret] = adminApiKey.split(':');
    const { createHmac, createSign } = (() => {
      try {
        const crypto = require('crypto');
        return crypto;
      } catch {
        return null;
      }
    })();

    if (createHmac) {
      const header = Buffer.from(JSON.stringify({ kid: id, typ: 'JWT', alg: 'HS256' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          exp: Math.floor(Date.now() / 1000) + 300,
          iat: Math.floor(Date.now() / 1000),
          aud: '/admin/',
        }),
      ).toString('base64url');
      const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
      return `${header}.${payload}.${signature}`;
    }

    return adminApiKey;
  }

  validate(config: PlatformConfig): boolean {
    return !!(config.apiUrl || process.env.GHOST_API_URL) && !!(config.apiKey || process.env.GHOST_ADMIN_API_KEY);
  }

  async test(config: PlatformConfig): Promise<boolean> {
    try {
      const apiUrl = config.apiUrl || process.env.GHOST_API_URL;
      if (!apiUrl) return false;
      const response = await firstValueFrom(
        this.httpService.get(`${apiUrl}/ghost/api/admin/site/`, { timeout: 10000 }),
      );
      return response.status === 200;
    } catch {
      return false;
    }
  }
}

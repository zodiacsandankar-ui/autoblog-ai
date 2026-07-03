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
export class ShopifyHandler implements PlatformHandlerInterface {
  readonly platform = 'shopify';
  readonly name = 'Shopify';
  private readonly logger = new Logger(ShopifyHandler.name);

  constructor(private readonly httpService: HttpService) {}

  transform(article: any, config: PlatformConfig): TransformResult {
    return {
      title: article.title,
      content: article.content || '',
      excerpt: (article.excerpt || article.metaDescription || '').substring(0, 300),
      slug: article.slug || '',
      tags: Array.isArray(article.tags) ? article.tags : [],
      featuredImage: article.featuredImage || undefined,
      metaTitle: article.metaTitle || '',
      metaDescription: article.metaDescription || '',
    };
  }

  async publish(article: any, config: PlatformConfig): Promise<PublishResult> {
    try {
      const shopDomain = config.apiUrl || process.env.SHOPIFY_STORE_DOMAIN;
      const accessToken = config.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;

      if (!shopDomain || !accessToken) {
        return {
          success: false,
          platform: this.platform,
          error: 'Shopify credentials not configured',
          publishedAt: new Date(),
        };
      }

      const transformed = this.transform(article, config);

      const blogId = config.additionalConfig?.blogId || process.env.SHOPIFY_BLOG_ID || 'default';

      const response = await firstValueFrom(
        this.httpService.post(
          `https://${shopDomain}/admin/api/2024-01/blogs/${blogId}/articles.json`,
          {
            article: {
              title: transformed.title,
              body_html: transformed.content,
              excerpt: transformed.excerpt,
              slug: transformed.slug,
              tags: transformed.tags.join(', '),
              image: transformed.featuredImage ? { src: transformed.featuredImage } : undefined,
              author: config.additionalConfig?.author || 'AutoBlog AI',
              published: true,
              published_at: new Date().toISOString(),
              metafields: [
                { key: 'title_tag', value: transformed.metaTitle, type: 'single_line_text_field', namespace: 'global' },
                { key: 'description_tag', value: transformed.metaDescription, type: 'single_line_text_field', namespace: 'global' },
              ],
            },
          },
          {
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          },
        ),
      );

      const shopifyArticle = response.data?.article;
      return {
        success: true,
        platform: this.platform,
        url: shopifyArticle?.url,
        postId: String(shopifyArticle?.id),
        publishedAt: new Date(shopifyArticle?.published_at || new Date()),
      };
    } catch (error) {
      this.logger.error(`Shopify publish failed: ${error.message}`);
      return {
        success: false,
        platform: this.platform,
        error: error.response?.data?.errors?.toString() || error.message,
        publishedAt: new Date(),
      };
    }
  }

  validate(config: PlatformConfig): boolean {
    return !!(config.apiUrl || process.env.SHOPIFY_STORE_DOMAIN);
  }

  async test(config: PlatformConfig): Promise<boolean> {
    try {
      const shopDomain = config.apiUrl || process.env.SHOPIFY_STORE_DOMAIN;
      const accessToken = config.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;
      if (!shopDomain || !accessToken) return false;
      await firstValueFrom(
        this.httpService.get(`https://${shopDomain}/admin/api/2024-01/shop.json`, {
          headers: { 'X-Shopify-Access-Token': accessToken },
          timeout: 10000,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

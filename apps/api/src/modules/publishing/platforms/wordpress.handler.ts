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
export class WordPressHandler implements PlatformHandlerInterface {
  readonly platform = 'wordpress';
  readonly name = 'WordPress';
  private readonly logger = new Logger(WordPressHandler.name);

  constructor(private readonly httpService: HttpService) {}

  transform(article: any, config: PlatformConfig): TransformResult {
    return {
      title: article.metaTitle || article.title,
      content: this.wpFormatContent(article.content || ''),
      excerpt: article.excerpt || article.metaDescription || '',
      slug: article.slug || '',
      tags: Array.isArray(article.tags) ? article.tags : [],
      featuredImage: article.featuredImage || undefined,
      metaTitle: article.metaTitle || '',
      metaDescription: article.metaDescription || '',
      customFields: {
        _yoast_wpseo_title: article.metaTitle || '',
        _yoast_wpseo_metadesc: article.metaDescription || '',
        _aioseo_title: article.metaTitle || '',
        _aioseo_description: article.metaDescription || '',
      },
    };
  }

  async publish(article: any, config: PlatformConfig): Promise<PublishResult> {
    try {
      const apiUrl = config.apiUrl || process.env.WORDPRESS_API_URL;
      const username = config.username || process.env.WORDPRESS_USERNAME;
      const password = config.password || process.env.WORDPRESS_APP_PASSWORD;

      if (!apiUrl || !username || !password) {
        return {
          success: false,
          platform: this.platform,
          error: 'WordPress API credentials not configured',
          publishedAt: new Date(),
        };
      }

      const transformed = this.transform(article, config);
      const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

      const postData: Record<string, any> = {
        title: transformed.title,
        content: transformed.content,
        excerpt: transformed.excerpt,
        slug: transformed.slug,
        status: 'publish',
        comment_status: 'open',
      };

      if (transformed.tags.length > 0) {
        postData.tags = transformed.tags;
      }

      if (transformed.customFields) {
        postData.meta = transformed.customFields;
      }

      const response = await firstValueFrom(
        this.httpService.post(`${apiUrl}/wp/v2/posts`, postData, {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }),
      );

      return {
        success: true,
        platform: this.platform,
        url: response.data?.link,
        postId: String(response.data?.id),
        publishedAt: new Date(),
      };
    } catch (error) {
      // Try XML-RPC fallback
      try {
        return await this.publishViaXMLRPC(article, config);
      } catch (xmlError) {
        this.logger.error(`WordPress publish failed: ${error.message}`);
        return {
          success: false,
          platform: this.platform,
          error: error.response?.data?.message || error.message,
          publishedAt: new Date(),
        };
      }
    }
  }

  private async publishViaXMLRPC(article: any, config: PlatformConfig): Promise<PublishResult> {
    const apiUrl = config.apiUrl || process.env.WORDPRESS_API_URL;
    const username = config.username || process.env.WORDPRESS_USERNAME;
    const password = config.password || process.env.WORDPRESS_APP_PASSWORD;

    if (!apiUrl) throw new Error('WordPress URL not configured');

    const xmlRpcUrl = apiUrl.replace(/\/wp-json$/, '') + '/xmlrpc.php';
    const transformed = this.transform(article, config);

    const xmlBody = `<?xml version="1.0"?>
<methodCall>
  <methodName>wp.newPost</methodName>
  <params>
    <param><value><int>1</int></value></param>
    <param><value><string>${username || ''}</string></value></param>
    <param><value><string>${password || ''}</string></value></param>
    <param>
      <value>
        <struct>
          <member>
            <name>post_title</name>
            <value><string>${this.escapeXml(transformed.title)}</string></value>
          </member>
          <member>
            <name>post_content</name>
            <value><string>${this.escapeXml(transformed.content)}</string></value>
          </member>
          <member>
            <name>post_excerpt</name>
            <value><string>${this.escapeXml(transformed.excerpt || '')}</string></value>
          </member>
          <member>
            <name>post_status</name>
            <value><string>publish</string></value>
          </member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`;

    const response = await firstValueFrom(
      this.httpService.post(xmlRpcUrl, xmlBody, {
        headers: { 'Content-Type': 'text/xml' },
        timeout: 30000,
      }),
    );

    const match = response.data?.match(/<int>(\d+)<\/int>/);
    return {
      success: true,
      platform: this.platform,
      postId: match ? match[1] : undefined,
      url: `${apiUrl.replace(/\/wp-json.*$/, '')}/?p=${match ? match[1] : ''}`,
      publishedAt: new Date(),
    };
  }

  validate(config: PlatformConfig): boolean {
    return !!(config.apiUrl || process.env.WORDPRESS_API_URL);
  }

  async test(config: PlatformConfig): Promise<boolean> {
    try {
      const apiUrl = config.apiUrl || process.env.WORDPRESS_API_URL;
      if (!apiUrl) return false;
      const response = await firstValueFrom(
        this.httpService.get(`${apiUrl}/wp/v2/`, { timeout: 10000 }),
      );
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private wpFormatContent(content: string): string {
    if (!content) return '';
    if (content.startsWith('<')) return content;
    return content
      .split('\n\n')
      .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
      .join('\n');
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

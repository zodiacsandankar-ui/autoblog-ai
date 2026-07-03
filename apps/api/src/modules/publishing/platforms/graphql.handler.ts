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
export class GraphqlHandler implements PlatformHandlerInterface {
  readonly platform = 'graphql';
  readonly name = 'Custom GraphQL';
  private readonly logger = new Logger(GraphqlHandler.name);

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
      const apiUrl = config.apiUrl || process.env.GRAPHQL_API_URL;
      const apiKey = config.apiKey || process.env.GRAPHQL_API_KEY;
      const mutationName = config.additionalConfig?.mutationName || 'createPost';

      if (!apiUrl) {
        return {
          success: false,
          platform: this.platform,
          error: 'GraphQL API URL not configured',
          publishedAt: new Date(),
        };
      }

      const transformed = this.transform(article, config);
      const mutationTemplate = config.additionalConfig?.mutation || `
mutation CreatePost($input: PostInput!) {
  ${mutationName}(input: $input) {
    id
    url
    publishedAt
  }
}`;

      const variables: Record<string, any> = {
        input: {
          title: transformed.title,
          content: transformed.content,
          excerpt: transformed.excerpt,
          slug: transformed.slug,
          tags: transformed.tags,
          featuredImage: transformed.featuredImage,
          status: 'PUBLISH',
          meta: {
            title: transformed.metaTitle,
            description: transformed.metaDescription,
          },
          publishedAt: new Date().toISOString(),
        },
      };

      if (config.additionalConfig?.variables) {
        Object.assign(variables.input, config.additionalConfig.variables);
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'AutoBlog-AI/1.0',
      };

      if (apiKey) {
        const authHeader = config.additionalConfig?.authHeader || 'Authorization';
        const authPrefix = config.additionalConfig?.authPrefix || 'Bearer';
        headers[authHeader] = `${authPrefix} ${apiKey}`;
      }

      const response = await firstValueFrom(
        this.httpService.post(
          apiUrl,
          {
            query: mutationTemplate,
            variables,
          },
          {
            headers,
            timeout: 30000,
          },
        ),
      );

      if (response.data?.errors) {
        throw new Error(response.data.errors[0]?.message || 'GraphQL mutation failed');
      }

      const result = response.data?.data?.[mutationName];

      return {
        success: true,
        platform: this.platform,
        postId: result?.id || String(Date.now()),
        url: result?.url || apiUrl,
        publishedAt: new Date(result?.publishedAt || new Date()),
      };
    } catch (error) {
      this.logger.error(`GraphQL publish failed: ${error.message}`);
      return {
        success: false,
        platform: this.platform,
        error: error.message,
        publishedAt: new Date(),
      };
    }
  }

  validate(config: PlatformConfig): boolean {
    return !!(config.apiUrl || process.env.GRAPHQL_API_URL);
  }

  async test(config: PlatformConfig): Promise<boolean> {
    try {
      const apiUrl = config.apiUrl || process.env.GRAPHQL_API_URL;
      if (!apiUrl) return false;
      await firstValueFrom(
        this.httpService.post(
          apiUrl,
          { query: '{ __typename }' },
          { headers: { 'Content-Type': 'application/json' }, timeout: 10000 },
        ),
      );
      return true;
    } catch {
      return false;
    }
  }
}

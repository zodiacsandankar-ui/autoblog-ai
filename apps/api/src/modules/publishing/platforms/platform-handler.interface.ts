export interface PublishResult {
  success: boolean;
  platform: string;
  url?: string;
  postId?: string;
  error?: string;
  publishedAt: Date;
}

export interface TransformResult {
  title: string;
  content: string;
  excerpt?: string;
  slug?: string;
  tags?: string[];
  featuredImage?: string;
  metaTitle?: string;
  metaDescription?: string;
  customFields?: Record<string, any>;
}

export interface PlatformConfig {
  enabled: boolean;
  apiUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  username?: string;
  password?: string;
  endpoint?: string;
  webhookUrl?: string;
  additionalConfig?: Record<string, any>;
}

export interface PlatformHandlerInterface {
  readonly platform: string;
  readonly name: string;

  transform(article: any, config: PlatformConfig): TransformResult;
  publish(article: any, config: PlatformConfig): Promise<PublishResult>;
  validate?(config: PlatformConfig): boolean;
  test?(config: PlatformConfig): Promise<boolean>;
}

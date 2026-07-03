import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { CacheService } from '../../cache/cache.service';
import {
  Website,
  CustomPage,
  Comment,
  Subscriber,
  Theme,
  WebsiteStatus,
  CommentStatus,
  SubscriberStatus,
  PageStatus,
} from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class WebsitesService {
  private readonly logger = new Logger(WebsitesService.name);
  private readonly baseDomain: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly cache: CacheService,
  ) {
    this.baseDomain = this.configService.get<string>(
      'WEBSITE_BASE_DOMAIN',
      'autoblog.ai',
    );
  }

  // -----------------------------------------------------------------------
  // Website CRUD
  // -----------------------------------------------------------------------

  async createWebsite(
    projectId: string,
    config: {
      subdomain: string;
      customDomain?: string;
      siteTitle?: string;
      siteDescription?: string;
      siteLogo?: string;
      favicon?: string;
      googleAnalyticsId?: string;
      gtmId?: string;
      themeId?: string;
      themeConfig?: Record<string, unknown>;
      status?: WebsiteStatus;
    },
  ): Promise<Website> {
    // Validate project exists
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Check if project already has a website
    const existing = await this.prisma.website.findUnique({
      where: { projectId },
    });
    if (existing) {
      throw new ConflictException(
        'Project already has a website. Use update instead.',
      );
    }

    // Check subdomain availability
    const subdomainTaken = await this.prisma.website.findUnique({
      where: { subdomain: config.subdomain },
    });
    if (subdomainTaken) {
      throw new ConflictException('Subdomain is already taken');
    }

    // Check custom domain availability
    if (config.customDomain) {
      const domainTaken = await this.prisma.website.findUnique({
        where: { customDomain: config.customDomain },
      });
      if (domainTaken) {
        throw new ConflictException('Custom domain is already in use');
      }
    }

    const domain = `${config.subdomain}.${this.baseDomain}`;

    const website = await this.prisma.website.create({
      data: {
        projectId,
        domain,
        subdomain: config.subdomain,
        customDomain: config.customDomain || null,
        siteTitle: config.siteTitle || project.name,
        siteDescription: config.siteDescription || null,
        siteLogo: config.siteLogo || null,
        favicon: config.favicon || null,
        googleAnalyticsId: config.googleAnalyticsId || null,
        gtmId: config.gtmId || null,
        themeId: config.themeId || null,
        themeConfig: (config.themeConfig || {}) as Record<string, unknown>,
        status: config.status || WebsiteStatus.DRAFT,
        sslEnabled: false,
        settings: {},
        socialLinks: {},
        headerConfig: { type: 'default' },
        footerConfig: { type: 'default' },
        homePage: { type: 'blog' },
        customPages: [],
      },
    });

    this.logger.log(`Website created: ${domain} for project=${projectId}`);
    return website;
  }

  async updateTheme(
    websiteId: string,
    themeConfig: Record<string, unknown>,
  ): Promise<Website> {
    const website = await this.prisma.website.findUnique({
      where: { id: websiteId },
    });
    if (!website) {
      throw new NotFoundException('Website not found');
    }

    // Merge with existing theme config
    const existingConfig = (website.themeConfig as Record<string, unknown>) || {};
    const merged = { ...existingConfig, ...themeConfig };

    const updated = await this.prisma.website.update({
      where: { id: websiteId },
      data: { themeConfig: merged as Record<string, unknown> },
    });

    await this.cache.del(`website:${website.domain}`);
    if (website.customDomain) {
      await this.cache.del(`website:${website.customDomain}`);
    }

    return updated;
  }

  async getPublishedWebsite(domain: string): Promise<Website | null> {
    const cacheKey = `website:${domain}`;
    const cached = await this.cache.get<Website>(cacheKey);
    if (cached) return cached;

    // Look up by domain, subdomain, or custom domain
    const website = await this.prisma.website.findFirst({
      where: {
        OR: [
          { domain },
          { subdomain: domain },
          { customDomain: domain },
        ],
        status: WebsiteStatus.PUBLISHED,
      },
      include: {
        project: {
          select: {
            name: true,
            language: true,
          },
        },
        theme: true,
      },
    });

    if (website) {
      await this.cache.set(cacheKey, website, 300); // 5 min cache
    }

    return website;
  }

  // -----------------------------------------------------------------------
  // Custom Domains
  // -----------------------------------------------------------------------

  async addCustomDomain(
    websiteId: string,
    domain: string,
  ): Promise<Website> {
    const website = await this.prisma.website.findUnique({
      where: { id: websiteId },
    });
    if (!website) {
      throw new NotFoundException('Website not found');
    }

    // Check domain not in use
    const domainTaken = await this.prisma.website.findUnique({
      where: { customDomain: domain },
    });
    if (domainTaken) {
      throw new ConflictException('Domain is already in use');
    }

    // In production, verify DNS and provision SSL via ACM/LetsEncrypt
    const updated = await this.prisma.website.update({
      where: { id: websiteId },
      data: {
        customDomain: domain,
        sslEnabled: true,
      },
    });

    this.logger.log(`Custom domain "${domain}" added to website=${websiteId}`);
    return updated;
  }

  async removeCustomDomain(websiteId: string): Promise<Website> {
    const website = await this.prisma.website.findUnique({
      where: { id: websiteId },
    });
    if (!website) {
      throw new NotFoundException('Website not found');
    }

    if (!website.customDomain) {
      throw new BadRequestException('No custom domain to remove');
    }

    const updated = await this.prisma.website.update({
      where: { id: websiteId },
      data: {
        customDomain: null,
        sslEnabled: false,
        sslCertificate: null,
      },
    });

    await this.cache.del(`website:${website.customDomain}`);
    this.logger.log(`Custom domain removed from website=${websiteId}`);
    return updated;
  }

  // -----------------------------------------------------------------------
  // Pages
  // -----------------------------------------------------------------------

  async getPages(websiteId: string): Promise<CustomPage[]> {
    const website = await this.prisma.website.findUnique({
      where: { id: websiteId },
    });
    if (!website) {
      throw new NotFoundException('Website not found');
    }

    return this.prisma.customPage.findMany({
      where: { websiteId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createPage(
    websiteId: string,
    page: {
      slug: string;
      title: string;
      metaDescription?: string;
      blocks?: Record<string, unknown>[];
      schemaMarkup?: Record<string, unknown>;
      canonicalUrl?: string;
      noindex?: boolean;
      status?: PageStatus;
    },
  ): Promise<CustomPage> {
    const website = await this.prisma.website.findUnique({
      where: { id: websiteId },
    });
    if (!website) {
      throw new NotFoundException('Website not found');
    }

    // Check unique slug per website
    const existingSlug = await this.prisma.customPage.findUnique({
      where: { websiteId_slug: { websiteId, slug: page.slug } },
    });
    if (existingSlug) {
      throw new ConflictException(
        `A page with slug "${page.slug}" already exists on this website`,
      );
    }

    return this.prisma.customPage.create({
      data: {
        websiteId,
        slug: page.slug,
        title: page.title,
        metaDescription: page.metaDescription || null,
        blocks: (page.blocks || []) as Record<string, unknown>,
        schemaMarkup: (page.schemaMarkup || {}) as Record<string, unknown>,
        canonicalUrl: page.canonicalUrl || null,
        noindex: page.noindex || false,
        status: page.status || PageStatus.DRAFT,
      },
    });
  }

  async updatePage(
    pageId: string,
    page: {
      title?: string;
      metaDescription?: string;
      blocks?: Record<string, unknown>[];
      schemaMarkup?: Record<string, unknown>;
      canonicalUrl?: string;
      noindex?: boolean;
      status?: PageStatus;
    },
  ): Promise<CustomPage> {
    const existing = await this.prisma.customPage.findUnique({
      where: { id: pageId },
    });
    if (!existing) {
      throw new NotFoundException('Page not found');
    }

    return this.prisma.customPage.update({
      where: { id: pageId },
      data: {
        ...(page.title !== undefined && { title: page.title }),
        ...(page.metaDescription !== undefined && { metaDescription: page.metaDescription }),
        ...(page.blocks !== undefined && { blocks: page.blocks as Record<string, unknown> }),
        ...(page.schemaMarkup !== undefined && { schemaMarkup: page.schemaMarkup as Record<string, unknown> }),
        ...(page.canonicalUrl !== undefined && { canonicalUrl: page.canonicalUrl }),
        ...(page.noindex !== undefined && { noindex: page.noindex }),
        ...(page.status !== undefined && { status: page.status }),
        ...(page.status === PageStatus.PUBLISHED && { publishedAt: new Date() }),
      },
    });
  }

  async deletePage(pageId: string): Promise<void> {
    const existing = await this.prisma.customPage.findUnique({
      where: { id: pageId },
    });
    if (!existing) {
      throw new NotFoundException('Page not found');
    }

    await this.prisma.customPage.delete({
      where: { id: pageId },
    });
  }

  // -----------------------------------------------------------------------
  // Themes
  // -----------------------------------------------------------------------

  async getThemes(): Promise<Theme[]> {
    const cacheKey = 'themes:all';
    const cached = await this.cache.get<Theme[]>(cacheKey);
    if (cached) return cached;

    const themes = await this.prisma.theme.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: 'desc' },
    });

    await this.cache.set(cacheKey, themes, 600); // 10 min cache
    return themes;
  }

  async installTheme(websiteId: string, themeId: string): Promise<Website> {
    const website = await this.prisma.website.findUnique({
      where: { id: websiteId },
    });
    if (!website) {
      throw new NotFoundException('Website not found');
    }

    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });
    if (!theme) {
      throw new NotFoundException('Theme not found');
    }

    const updated = await this.prisma.website.update({
      where: { id: websiteId },
      data: {
        themeId,
        themeConfig: (theme.defaultConfig || {}) as Record<string, unknown>,
      },
    });

    await this.cache.del(`website:${website.domain}`);
    if (website.customDomain) {
      await this.cache.del(`website:${website.customDomain}`);
    }

    return updated;
  }

  // -----------------------------------------------------------------------
  // Publish / Unpublish
  // -----------------------------------------------------------------------

  async publishWebsite(websiteId: string): Promise<Website> {
    const website = await this.prisma.website.findUnique({
      where: { id: websiteId },
    });
    if (!website) {
      throw new NotFoundException('Website not found');
    }

    if (website.status === WebsiteStatus.PUBLISHED) {
      return website;
    }

    const updated = await this.prisma.website.update({
      where: { id: websiteId },
      data: { status: WebsiteStatus.PUBLISHED },
    });

    this.logger.log(`Website published: ${website.domain}`);
    return updated;
  }

  async unpublishWebsite(websiteId: string): Promise<Website> {
    const website = await this.prisma.website.findUnique({
      where: { id: websiteId },
    });
    if (!website) {
      throw new NotFoundException('Website not found');
    }

    const updated = await this.prisma.website.update({
      where: { id: websiteId },
      data: { status: WebsiteStatus.DRAFT },
    });

    await this.cache.del(`website:${website.domain}`);
    if (website.customDomain) {
      await this.cache.del(`website:${website.customDomain}`);
    }

    this.logger.log(`Website unpublished: ${website.domain}`);
    return updated;
  }

  // -----------------------------------------------------------------------
  // Comments
  // -----------------------------------------------------------------------

  async getComments(
    articleId: string,
    status?: CommentStatus,
    pagination?: { page?: number; limit?: number },
  ) {
    const page = pagination?.page || 1;
    const limit = Math.min(pagination?.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { articleId };
    if (status) {
      where.status = status;
    }

    const [data, total] = await Promise.all([
      this.prisma.comment.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          replies: {
            where: { status: CommentStatus.APPROVED },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      this.prisma.comment.count({
        where: where as any,
      }),
    ]);

    return { data, total, page, limit };
  }

  async createComment(
    articleId: string,
    comment: {
      parentId?: string;
      authorName: string;
      authorEmail: string;
      authorAvatar?: string;
      content: string;
    },
  ): Promise<Comment> {
    // Verify article exists
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
    });
    if (!article) {
      throw new NotFoundException('Article not found');
    }

    // Auto-approve for now; can be configured per website
    const status = CommentStatus.PENDING;

    return this.prisma.comment.create({
      data: {
        articleId,
        parentId: comment.parentId || null,
        authorName: comment.authorName,
        authorEmail: comment.authorEmail,
        authorAvatar: comment.authorAvatar || null,
        content: comment.content,
        status,
      },
    });
  }

  async moderateComment(
    commentId: string,
    status: CommentStatus,
  ): Promise<Comment> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    return this.prisma.comment.update({
      where: { id: commentId },
      data: {
        status,
        moderatedAt: new Date(),
      },
    });
  }

  // -----------------------------------------------------------------------
  // Subscribers
  // -----------------------------------------------------------------------

  async getSubscribers(
    websiteId: string,
    pagination?: { page?: number; limit?: number },
  ) {
    const page = pagination?.page || 1;
    const limit = Math.min(pagination?.limit || 50, 200);
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.subscriber.findMany({
        where: { websiteId, status: SubscriberStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.subscriber.count({
        where: { websiteId, status: SubscriberStatus.ACTIVE },
      }),
    ]);

    return { data, total, page, limit };
  }

  async addSubscriber(
    websiteId: string,
    email: string,
    name?: string,
  ): Promise<Subscriber> {
    const website = await this.prisma.website.findUnique({
      where: { id: websiteId },
    });
    if (!website) {
      throw new NotFoundException('Website not found');
    }

    // Check if already subscribed
    const existing = await this.prisma.subscriber.findUnique({
      where: { websiteId_email: { websiteId, email } },
    });

    if (existing) {
      if (existing.status === SubscriberStatus.ACTIVE) {
        throw new BadRequestException('Email is already subscribed');
      }
      // Re-subscribe
      return this.prisma.subscriber.update({
        where: { id: existing.id },
        data: {
          status: SubscriberStatus.ACTIVE,
          name: name || existing.name,
          verifyToken: null,
          verifiedAt: new Date(),
        },
      });
    }

    const verifyToken = crypto.randomBytes(32).toString('hex');

    return this.prisma.subscriber.create({
      data: {
        websiteId,
        email,
        name: name || null,
        status: SubscriberStatus.ACTIVE,
        verifyToken,
        verifiedAt: new Date(), // Auto-verify; in production, send verification email
        source: 'website',
      },
    });
  }

  async unsubscribe(token: string): Promise<void> {
    const subscriber = await this.prisma.subscriber.findFirst({
      where: { verifyToken: token },
    });

    if (!subscriber) {
      throw new NotFoundException('Invalid unsubscribe token');
    }

    await this.prisma.subscriber.update({
      where: { id: subscriber.id },
      data: {
        status: SubscriberStatus.UNSUBSCRIBED,
        verifyToken: null,
      },
    });

    this.logger.log(`Subscriber ${subscriber.email} unsubscribed`);
  }

  async exportSubscribers(
    websiteId: string,
    format: 'csv' | 'json' = 'json',
  ): Promise<string | Buffer> {
    const subscribers = await this.prisma.subscriber.findMany({
      where: { websiteId, status: SubscriberStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });

    if (format === 'csv') {
      const header = 'email,name,subscribedAt\n';
      const rows = subscribers
        .map(
          (s) =>
            `"${s.email}","${s.name || ''}","${s.createdAt.toISOString()}"`,
        )
        .join('\n');
      return Buffer.from(header + rows, 'utf-8');
    }

    return JSON.stringify(
      subscribers.map((s) => ({
        email: s.email,
        name: s.name,
        subscribedAt: s.createdAt.toISOString(),
      })),
      null,
      2,
    );
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  async findByProjectId(projectId: string): Promise<Website | null> {
    return this.prisma.website.findUnique({
      where: { projectId },
    });
  }

  async findById(websiteId: string): Promise<Website | null> {
    return this.prisma.website.findUnique({
      where: { id: websiteId },
      include: {
        theme: true,
        customPages: {
          where: { status: PageStatus.PUBLISHED },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }
}

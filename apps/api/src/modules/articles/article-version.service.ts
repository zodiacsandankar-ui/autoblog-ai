import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ArticleVersionService {
  private readonly logger = new Logger(ArticleVersionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createVersion(
    articleId: string,
    content: string,
    metadata: Record<string, any> = {},
    changeDescription?: string,
  ): Promise<any> {
    const article = await this.prisma.article.findUnique({ where: { id: articleId } });
    if (!article) {
      throw new NotFoundException(`Article ${articleId} not found`);
    }

    const currentMaxVersion = await this.prisma.articleVersion.findFirst({
      where: { articleId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    const versionNumber = (currentMaxVersion?.versionNumber || 0) + 1;

    const version = await this.prisma.articleVersion.create({
      data: {
        articleId,
        versionNumber,
        title: article.title,
        slug: article.slug,
        content: content || article.content || '',
        excerpt: article.excerpt || '',
        metaTitle: article.metaTitle || '',
        metaDescription: article.metaDescription || '',
        tags: article.tags || [],
        keywords: article.keywords || [],
        seo: article.seo || {},
        wordCount: this.countWords(content || article.content || ''),
        changeDescription: changeDescription || `Version ${versionNumber}`,
        metadata,
        createdBy: metadata.createdBy || 'system',
      },
    });

    await this.prisma.article.update({
      where: { id: articleId },
      data: { version: versionNumber },
    });

    this.logger.log(`Created version ${versionNumber} for article ${articleId}`);
    return version;
  }

  async getVersions(articleId: string): Promise<any[]> {
    const article = await this.prisma.article.findUnique({ where: { id: articleId } });
    if (!article) {
      throw new NotFoundException(`Article ${articleId} not found`);
    }

    return this.prisma.articleVersion.findMany({
      where: { articleId },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        wordCount: true,
        changeDescription: true,
        createdAt: true,
        createdBy: true,
      },
    });
  }

  async getVersion(articleId: string, versionNumber: number): Promise<any> {
    const version = await this.prisma.articleVersion.findFirst({
      where: { articleId, versionNumber },
    });
    if (!version) {
      throw new NotFoundException(`Version ${versionNumber} not found for article ${articleId}`);
    }
    return version;
  }

  async restoreVersion(articleId: string, versionNumber: number): Promise<any> {
    const article = await this.prisma.article.findUnique({ where: { id: articleId } });
    if (!article) {
      throw new NotFoundException(`Article ${articleId} not found`);
    }

    const version = await this.getVersion(articleId, versionNumber);

    const newVersion = await this.createVersion(
      articleId,
      version.content,
      { restoredFrom: versionNumber },
      `Restored from version ${versionNumber}`,
    );

    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        content: version.content,
        title: version.title,
        slug: version.slug,
        excerpt: version.excerpt || undefined,
        metaTitle: version.metaTitle || undefined,
        metaDescription: version.metaDescription || undefined,
        tags: version.tags as string[] | undefined,
        keywords: version.keywords as string[] | undefined,
        seo: version.seo as Record<string, any> | undefined,
      },
    });

    this.logger.log(`Restored article ${articleId} to version ${versionNumber}`);
    return { article: updated, version: newVersion };
  }

  async diffVersions(articleId: string, versionA: number, versionB: number): Promise<any> {
    const [verA, verB] = await Promise.all([
      this.getVersion(articleId, versionA),
      this.getVersion(articleId, versionB),
    ]);

    return {
      versionA: { number: versionA, wordCount: verA.wordCount, title: verA.title },
      versionB: { number: versionB, wordCount: verB.wordCount, title: verB.title },
      changes: {
        titleChanged: verA.title !== verB.title,
        wordCountDiff: (verB.wordCount || 0) - (verA.wordCount || 0),
        contentLengthDiff: (verB.content?.length || 0) - (verA.content?.length || 0),
      },
      createdAt: new Date(),
    };
  }

  async cleanupOldVersions(articleId: string, keepLast: number = 10): Promise<number> {
    const versions = await this.prisma.articleVersion.findMany({
      where: { articleId },
      orderBy: { versionNumber: 'desc' },
      skip: keepLast,
      select: { id: true },
    });

    if (versions.length === 0) return 0;

    const idsToDelete = versions.map((v) => v.id);
    const result = await this.prisma.articleVersion.deleteMany({
      where: { id: { in: idsToDelete } },
    });

    this.logger.log(`Cleaned up ${result.count} old versions for article ${articleId}`);
    return result.count;
  }

  private countWords(text: string): number {
    if (!text) return 0;
    return text
      .replace(/<[^>]*>/g, '')
      .split(/[\s\n]+/)
      .filter((w) => w.length > 0).length;
  }
}

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { Project, ProjectStatus } from '@prisma/client';
import * as slug from 'slug';
import * as crypto from 'crypto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  async create(
    data: {
      name: string;
      description?: string;
      language?: string;
      targetCountry?: string;
      tone?: string;
      writingStyle?: string;
      articleLength?: number;
      postingFrequency?: string;
      timezone?: string;
      settings?: Record<string, unknown>;
      status?: ProjectStatus;
      organizationId?: string;
    },
    userId: string,
  ): Promise<Project> {
    const projectSlug = this.generateSlug(data.name);

    // Check slug uniqueness within user's scope
    const existing = await this.prisma.project.findFirst({
      where: { slug: projectSlug },
    });
    if (existing) {
      throw new ConflictException(
        `A project with slug "${projectSlug}" already exists`,
      );
    }

    // If no organization, find or use the user's personal org
    let organizationId = data.organizationId;
    if (!organizationId) {
      const userOrg = await this.prisma.organizationMember.findFirst({
        where: { userId },
        include: { organization: true },
        orderBy: { createdAt: 'asc' },
      });
      organizationId = userOrg?.organizationId;
    }

    if (!organizationId) {
      throw new NotFoundException(
        'No organization found. Create an organization first.',
      );
    }

    const project = await this.prisma.project.create({
      data: {
        name: data.name,
        slug: projectSlug,
        description: data.description || null,
        language: data.language || null,
        targetCountry: data.targetCountry || null,
        tone: data.tone || null,
        writingStyle: data.writingStyle || null,
        articleLength: data.articleLength || null,
        postingFrequency: data.postingFrequency || null,
        timezone: data.timezone || null,
        settings: (data.settings || {}) as Record<string, unknown>,
        status: data.status || ProjectStatus.ACTIVE,
        organizationId,
        userId,
      },
    });

    this.logger.log(`Project created: ${project.name} (${project.id})`);
    return project;
  }

  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      language?: string;
      targetCountry?: string;
      tone?: string;
      writingStyle?: string;
      articleLength?: number;
      postingFrequency?: string;
      timezone?: string;
      settings?: Record<string, unknown>;
      status?: ProjectStatus;
    },
  ): Promise<Project> {
    const project = await this.prisma.project.findUnique({
      where: { id },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) {
      updateData.name = data.name;
      updateData.slug = this.generateSlug(data.name);
    }
    if (data.description !== undefined) updateData.description = data.description;
    if (data.language !== undefined) updateData.language = data.language;
    if (data.targetCountry !== undefined) updateData.targetCountry = data.targetCountry;
    if (data.tone !== undefined) updateData.tone = data.tone;
    if (data.writingStyle !== undefined) updateData.writingStyle = data.writingStyle;
    if (data.articleLength !== undefined) updateData.articleLength = data.articleLength;
    if (data.postingFrequency !== undefined) updateData.postingFrequency = data.postingFrequency;
    if (data.timezone !== undefined) updateData.timezone = data.timezone;
    if (data.settings !== undefined) updateData.settings = data.settings as Record<string, unknown>;
    if (data.status !== undefined) updateData.status = data.status;

    const updated = await this.prisma.project.update({
      where: { id },
      data: updateData,
    });

    await this.cache.del(`project:${id}`);
    await this.cache.delPattern(`projects:user:*`);
    await this.cache.delPattern(`projects:org:*`);

    this.logger.log(`Project updated: ${updated.name} (${updated.id})`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Soft delete / archive
    await this.prisma.project.update({
      where: { id },
      data: { status: ProjectStatus.ARCHIVED },
    });

    await this.cache.del(`project:${id}`);
    await this.cache.delPattern(`projects:user:*`);
    await this.cache.delPattern(`projects:org:*`);

    this.logger.log(`Project archived (soft delete): ${project.name} (${id})`);
  }

  async findById(id: string): Promise<Project | null> {
    const cacheKey = `project:${id}`;
    const cached = await this.cache.get<Project>(cacheKey);
    if (cached) return cached;

    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        organization: {
          select: { id: true, name: true, slug: true, plan: true },
        },
        website: {
          select: { id: true, domain: true, status: true },
        },
        _count: {
          select: {
            articles: true,
            keywords: true,
            trends: true,
            competitors: true,
            workflows: true,
          },
        },
      },
    });

    if (project) {
      await this.cache.set(cacheKey, project, 300); // 5 min cache
    }

    return project;
  }

  async findByUser(userId: string): Promise<Project[]> {
    const cacheKey = `projects:user:${userId}`;
    const cached = await this.cache.get<Project[]>(cacheKey);
    if (cached) return cached;

    const projects = await this.prisma.project.findMany({
      where: { userId, status: { not: ProjectStatus.ARCHIVED } },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: {
            articles: true,
            keywords: true,
          },
        },
      },
    });

    await this.cache.set(cacheKey, projects, 120); // 2 min cache
    return projects;
  }

  async findByOrg(organizationId: string): Promise<Project[]> {
    const cacheKey = `projects:org:${organizationId}`;
    const cached = await this.cache.get<Project[]>(cacheKey);
    if (cached) return cached;

    const projects = await this.prisma.project.findMany({
      where: { organizationId, status: { not: ProjectStatus.ARCHIVED } },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: {
            articles: true,
            keywords: true,
            workflows: true,
          },
        },
        website: {
          select: { id: true, domain: true, status: true },
        },
      },
    });

    await this.cache.set(cacheKey, projects, 120); // 2 min cache
    return projects;
  }

  // -----------------------------------------------------------------------
  // Publishing Platforms
  // -----------------------------------------------------------------------

  async addPublishingPlatform(
    projectId: string,
    platform: {
      type: string;
      name: string;
      config?: Record<string, unknown>;
    },
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const created = await this.prisma.publishingPlatform.create({
      data: {
        projectId,
        type: platform.type,
        name: platform.name,
        config: (platform.config || {}) as Record<string, unknown>,
        isActive: true,
      },
    });

    await this.cache.del(`project:${projectId}`);
    this.logger.log(
      `Publishing platform "${platform.name}" (${platform.type}) added to project=${projectId}`,
    );
    return created;
  }

  async removePublishingPlatform(projectId: string, platformId: string): Promise<void> {
    const platform = await this.prisma.publishingPlatform.findFirst({
      where: { id: platformId, projectId },
    });
    if (!platform) {
      throw new NotFoundException('Publishing platform not found');
    }

    await this.prisma.publishingPlatform.delete({
      where: { id: platformId },
    });

    await this.cache.del(`project:${projectId}`);
    this.logger.log(`Publishing platform ${platformId} removed from project=${projectId}`);
  }

  async getPublishingPlatforms(projectId: string) {
    return this.prisma.publishingPlatform.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // -----------------------------------------------------------------------
  // Settings
  // -----------------------------------------------------------------------

  async updateSettings(
    projectId: string,
    settings: Record<string, unknown>,
  ): Promise<Project> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const existingSettings = (project.settings as Record<string, unknown>) || {};
    const merged = { ...existingSettings, ...settings };

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { settings: merged as Record<string, unknown> },
    });

    await this.cache.del(`project:${projectId}`);
    return updated;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private generateSlug(name: string): string {
    const base = slug(name, { lower: true });
    const suffix = crypto.randomBytes(4).toString('hex');
    return `${base}-${suffix}`;
  }
}

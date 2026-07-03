import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { DeepSeekService } from '../../ai/providers/deepseek.service';
import { PublishingService } from '../publishing/publishing.service';
import { ScheduleConfigDto, CalendarQueryDto } from './dto/schedule-config.dto';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deepseek: DeepSeekService,
    private readonly publishingService: PublishingService,
    @InjectQueue('scheduler') private schedulerQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processScheduledPosts(): Promise<void> {
    this.logger.log('Processing scheduled posts...');
    try {
      const now = new Date();
      const duePosts = await this.prisma.schedule.findMany({
        where: {
          status: 'scheduled',
          scheduledAt: { lte: now },
        },
        include: { article: true },
        take: 20,
      });
      this.logger.log(`Found ${duePosts.length} posts due for publishing`);
      for (const post of duePosts) {
        await this.schedulerQueue.add('publish', {
          scheduleId: post.id,
          articleId: post.articleId,
          projectId: post.projectId,
          platforms: post.platforms,
        });
      }
    } catch (error) {
      this.logger.error(`Error processing scheduled posts: ${error.message}`);
    }
  }

  async scheduleArticle(dto: ScheduleConfigDto): Promise<any> {
    this.validateSchedule(dto);
    const article = await this.prisma.article.findUnique({
      where: { id: dto.articleId },
    });
    if (!article) throw new NotFoundException(`Article ${dto.articleId} not found`);

    const existing = await this.prisma.schedule.findFirst({
      where: { articleId: dto.articleId, status: { in: ['scheduled', 'pending'] } },
    });
    if (existing) throw new BadRequestException('Article is already scheduled');

    const schedule = await this.prisma.schedule.create({
      data: {
        articleId: dto.articleId,
        projectId: dto.projectId || article.projectId,
        scheduledAt: new Date(dto.scheduledAt),
        frequency: dto.frequency || 'once',
        cronExpression: dto.cronExpression || null,
        timezone: dto.timezone || 'UTC',
        platforms: dto.platforms || ['wordpress'],
        socialPromotion: dto.socialPromotion ?? true,
        emailNotification: dto.emailNotification ?? false,
        priority: dto.priority ?? 0,
        status: 'scheduled',
      },
    });
    this.logger.log(`Article scheduled: ${schedule.id}`);
    return schedule;
  }

  private validateSchedule(dto: ScheduleConfigDto): void {
    const scheduledDate = new Date(dto.scheduledAt);
    if (scheduledDate <= new Date()) {
      throw new BadRequestException('Scheduled time must be in the future');
    }
    if (dto.platforms?.length) {
      const valid = ['wordpress', 'ghost', 'shopify', 'medium', 'blogger', 'webhook', 'rest-api', 'graphql'];
      for (const p of dto.platforms) {
        if (!valid.includes(p)) throw new BadRequestException(`Invalid platform: ${p}`);
      }
    }
  }

  async cancelSchedule(id: string): Promise<void> {
    const s = await this.prisma.schedule.findUnique({ where: { id } });
    if (!s) throw new NotFoundException(`Schedule ${id} not found`);
    await this.prisma.schedule.update({ where: { id }, data: { status: 'cancelled' } });
  }

  async getCalendar(query: CalendarQueryDto): Promise<any> {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.projectId) where.projectId = query.projectId;
    if (query.startDate || query.endDate) {
      where.scheduledAt = {};
      if (query.startDate) where.scheduledAt.gte = new Date(query.startDate);
      if (query.endDate) where.scheduledAt.lte = new Date(query.endDate);
    }
    const page = query.page || 1;
    const limit = query.limit || 50;
    const [data, total] = await Promise.all([
      this.prisma.schedule.findMany({
        where,
        orderBy: { scheduledAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { article: { select: { id: true, title: true, slug: true, status: true } } },
      }),
      this.prisma.schedule.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async getOptimalTimes(projectId: string, timezone = 'UTC', days = 30): Promise<any> {
    try {
      const past = await this.prisma.schedule.findMany({
        where: { projectId, status: 'published', scheduledAt: { gte: new Date(Date.now() - days * 86400000) } },
        orderBy: { scheduledAt: 'desc' },
        take: 50,
      });
      const response = await this.deepseek.complete({
        model: 'deepseek-reasoner',
        messages: [
          { role: 'system', content: 'You are a publishing schedule optimization expert. Return ONLY valid JSON.' },
          {
            role: 'user',
            content: JSON.stringify({
              task: 'Analyze publishing data, recommend optimal posting times',
              timezone,
              pastSchedules: past.map((s) => ({ scheduledAt: s.scheduledAt.toISOString() })),
              output_format: {
                optimalDays: 'string[]',
                optimalHours: 'string[]',
                recommendedSchedule: 'string',
                dayRankings: 'object',
                hourRankings: 'object',
                recommendations: 'string[]',
              },
            }),
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });
      return {
        projectId, timezone,
        ...JSON.parse(response.choices[0].message.content),
        generatedAt: new Date(),
      };
    } catch {
      return {
        projectId, timezone,
        optimalDays: ['Tuesday', 'Wednesday', 'Thursday'],
        optimalHours: ['08:00', '10:00', '14:00'],
        recommendations: ['Schedule weekday mornings 8-10 AM'],
        generatedAt: new Date(),
      };
    }
  }

  async findAll(filter: { page: number; limit: number; status?: string; projectId?: string }): Promise<any> {
    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.projectId) where.projectId = filter.projectId;
    const [data, total] = await Promise.all([
      this.prisma.schedule.findMany({
        where, orderBy: { scheduledAt: 'desc' },
        skip: (filter.page - 1) * filter.limit, take: filter.limit,
        include: { article: { select: { id: true, title: true, slug: true } } },
      }),
      this.prisma.schedule.count({ where }),
    ]);
    return { data, total, page: filter.page, limit: filter.limit };
  }

  async findById(id: string): Promise<any> {
    const s = await this.prisma.schedule.findUnique({ where: { id }, include: { article: true } });
    if (!s) throw new NotFoundException(`Schedule ${id} not found`);
    return s;
  }
}

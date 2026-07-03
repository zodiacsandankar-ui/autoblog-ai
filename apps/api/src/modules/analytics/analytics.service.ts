import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { DeepSeekService } from '../../ai/providers/deepseek.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deepseek: DeepSeekService,
  ) {}

  async getDashboardStats(projectId: string): Promise<any> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    const [
      totalArticles, publishedArticles, draftArticles,
      recentArticles, totalKeywords, totalTrends,
      totalSchedules, recentPublishLogs,
      tokenUsage, topArticles,
    ] = await Promise.all([
      this.prisma.article.count({ where: { projectId } }),
      this.prisma.article.count({ where: { projectId, status: 'published' } }),
      this.prisma.article.count({ where: { projectId, status: 'draft' } }),
      this.prisma.article.count({ where: { projectId, createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.keyword.count({ where: { projectId } }),
      this.prisma.trend.count({ where: { lastSeenAt: { gte: thirtyDaysAgo } } }),
      this.prisma.schedule.count({ where: { projectId, status: 'scheduled' } }),
      this.prisma.publishLog.count({ where: { projectId, publishedAt: { gte: thirtyDaysAgo } } }),
      this.getTokenUsage(projectId, { startDate: thirtyDaysAgo, endDate: now }),
      this.getTopArticles(projectId, 5),
    ]);

    return {
      projectId,
      projectName: project.name,
      content: {
        totalArticles, publishedArticles, draftArticles, recentArticles,
        publishedRate: totalArticles > 0 ? Math.round((publishedArticles / totalArticles) * 100) : 0,
      },
      keywords: { total: totalKeywords },
      trends: { activeLast30Days: totalTrends },
      publishing: { scheduledPosts: totalSchedules, recentPublishes: recentPublishLogs },
      traffic: { totalPageviews: 0, uniqueVisitors: 0, dataSource: 'ga4_pending' },
      tokenUsage: tokenUsage.total || { tokens: 0, cost: 0 },
      topArticles,
      generatedAt: now,
    };
  }

  async getTrafficData(projectId: string, dateRange: { startDate: Date; endDate: Date }): Promise<any> {
    const ga4PropertyId = process.env.GA4_PROPERTY_ID;
    if (!ga4PropertyId) {
      return {
        projectId, dateRange, dataSource: 'internal',
        dailyStats: await this.getInternalTrafficData(projectId, dateRange),
        totals: { pageviews: 0, uniqueVisitors: 0 },
      };
    }
    try {
      return await this.fetchFromGA4(ga4PropertyId, dateRange);
    } catch (error) {
      return {
        projectId, dateRange, dataSource: 'internal',
        dailyStats: await this.getInternalTrafficData(projectId, dateRange),
        totals: { pageviews: 0, uniqueVisitors: 0 },
      };
    }
  }

  async getKeywordRankings(projectId: string): Promise<any> {
    const keywords = await this.prisma.keyword.findMany({
      where: { projectId },
      orderBy: { searchVolume: 'desc' },
      take: 100,
    });

    const rankings = await Promise.all(
      keywords.slice(0, 20).map(async (kw) => {
        let position = null;
        try {
          const serpKey = process.env.SERPAPI_KEY;
          if (serpKey) {
            const { default: axios } = await import('axios');
            const res = await axios.get('https://serpapi.com/search', {
              params: { q: kw.keyword, api_key: serpKey, num: 5 },
              timeout: 8000,
            });
            position = res.data?.organic_results?.[0]?.position || null;
          }
        } catch { /* skip */ }
        return {
          keyword: kw.keyword, searchVolume: kw.searchVolume || 0,
          cpc: kw.cpc || 0, difficulty: kw.difficulty || 'unknown',
          currentPosition: position, checkedAt: new Date(),
        };
      }),
    );

    const ranked = rankings.filter((r) => r.currentPosition !== null);
    return {
      projectId, totalKeywords: keywords.length,
      keywordsWithRankings: ranked.length,
      averagePosition: ranked.length > 0
        ? ranked.reduce((s, r) => s + r.currentPosition, 0) / ranked.length : null,
      rankings, updatedAt: new Date(),
    };
  }

  async getTopArticles(projectId: string, limit = 10): Promise<any[]> {
    return this.prisma.article.findMany({
      where: { projectId, status: 'published' },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      select: {
        id: true, title: true, slug: true, wordCount: true,
        readingTime: true, publishedAt: true, status: true,
      },
    });
  }

  async getTokenUsage(projectId: string, dateRange: { startDate: Date; endDate: Date }): Promise<any> {
    const articles = await this.prisma.article.findMany({
      where: { projectId, createdAt: { gte: dateRange.startDate, lte: dateRange.endDate } },
    });
    const totalTokens = articles.reduce((sum, a) => sum + ((a as any).tokenCount || 0), 0);
    const cost = totalTokens * 0.000002;
    return {
      projectId,
      total: { tokens: totalTokens, cost: parseFloat(cost.toFixed(6)) },
      byModel: {
        'deepseek-reasoner': { tokens: Math.round(totalTokens * 0.7), cost: parseFloat((cost * 0.7).toFixed(6)) },
        'deepseek-chat': { tokens: Math.round(totalTokens * 0.3), cost: parseFloat((cost * 0.3).toFixed(6)) },
      },
      dateRange,
    };
  }

  async generateInsights(analyticsData: any): Promise<any> {
    try {
      const response = await this.deepseek.complete({
        model: 'deepseek-reasoner',
        messages: [
          { role: 'system', content: 'You are a content analytics analyst. Return ONLY valid JSON.' },
          {
            role: 'user',
            content: JSON.stringify({
              task: 'Generate analytics insights',
              data: analyticsData,
              output_format: {
                opportunities: 'string[]',
                warnings: 'string[]',
                trends: 'string[]',
                underperformingContent: 'string[]',
                refreshPriorities: 'string[]',
                keywordOpportunities: 'string[]',
                forecast: 'string',
                abTestIdeas: 'string[]',
                recommendations: 'string[]',
              },
            }),
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });
      return { generatedAt: new Date(), ...JSON.parse(response.choices[0].message.content) };
    } catch {
      return {
        generatedAt: new Date(),
        opportunities: ['Increase publishing frequency'],
        warnings: ['Connect Google Analytics for better insights'],
        recommendations: ['Set up GA4 integration'],
      };
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async snapshotAnalytics(projectId?: string): Promise<void> {
    try {
      if (projectId) {
        const stats = await this.getDashboardStats(projectId);
        await this.prisma.analyticsSnapshot.create({
          data: { projectId, data: stats as any, snapshotDate: new Date() },
        });
        return;
      }
      const projects = await this.prisma.project.findMany({ select: { id: true } });
      for (const p of projects) {
        try {
          const stats = await this.getDashboardStats(p.id);
          await this.prisma.analyticsSnapshot.create({
            data: { projectId: p.id, data: stats as any, snapshotDate: new Date() },
          });
        } catch (e) { this.logger.error(`Snapshot failed for ${p.id}: ${e.message}`); }
      }
    } catch (error) { this.logger.error(`Analytics snapshot failed: ${error.message}`); }
  }

  private async getInternalTrafficData(projectId: string, dateRange: { startDate: Date; endDate: Date }): Promise<any[]> {
    const logs = await this.prisma.publishLog.findMany({
      where: { projectId, publishedAt: { gte: dateRange.startDate, lte: dateRange.endDate } },
      orderBy: { publishedAt: 'asc' },
    });
    const dailyMap = new Map<string, number>();
    for (const log of logs) {
      const day = log.publishedAt.toISOString().split('T')[0];
      dailyMap.set(day, (dailyMap.get(day) || 0) + 1);
    }
    return Array.from(dailyMap.entries()).map(([date, count]) => ({ date, publishes: count }));
  }

  private async fetchFromGA4(propertyId: string, dateRange: { startDate: Date; endDate: Date }): Promise<any> {
    const token = process.env.GA4_ACCESS_TOKEN;
    if (!token) throw new Error('GA4 token not configured');
    const { default: axios } = await import('axios');
    const response = await axios.post(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        dateRanges: [{ startDate: dateRange.startDate.toISOString().split('T')[0], endDate: dateRange.endDate.toISOString().split('T')[0] }],
        metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }],
        dimensions: [{ name: 'date' }],
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 },
    );
    const rows = response.data?.rows || [];
    const dailyStats = rows.map((r: any) => ({
      date: r.dimensionValues?.[0]?.value,
      pageviews: parseInt(r.metricValues?.[0]?.value || '0', 10),
      visitors: parseInt(r.metricValues?.[1]?.value || '0', 10),
    }));
    return { dailyStats, totals: { pageviews: dailyStats.reduce((s: number, d: any) => s + d.pageviews, 0), uniqueVisitors: dailyStats.reduce((s: number, d: any) => s + d.visitors, 0) } };
  }
}

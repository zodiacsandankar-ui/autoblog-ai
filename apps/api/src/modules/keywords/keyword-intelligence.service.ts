import {
  Injectable,
  Logger,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { firstValueFrom } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

import { PrismaService } from '../../database/prisma.service';
import { DeepSeekService } from '../../ai/providers/deepseek.service';

// ---------------------------------------------------------------------------
// Internal types for keyword intelligence
// ---------------------------------------------------------------------------

interface KeywordResearchOptions {
  country?: string;
  language?: string;
  searchEngine?: string;
  includePAA?: boolean;
  includeRelated?: boolean;
  includeQuestions?: boolean;
  includeSERPFeatures?: boolean;
  maxKeywords?: number;
  minVolume?: number;
  maxDifficulty?: string;
  intents?: string[];
}

interface RawKeyword {
  keyword: string;
  type: string;
  searchVolume?: number;
  cpc?: number;
  competition?: string;
  difficulty?: number;
  intent?: string;
  trend?: string;
  relatedKeywords: string[];
  questions: string[];
  paaItems: string[];
  serpFeatures: string[];
  opportunityScore?: number;
  clusterName?: string;
  clusterId?: string;
  priority?: number;
}

interface SERPFeature {
  type: string;
  position: number;
  title?: string;
  url?: string;
  description?: string;
}

interface SERPResult {
  keyword: string;
  totalResults: number;
  organicResults: OrganicResult[];
  features: SERPFeature[];
  paaQuestions: string[];
  relatedSearches: string[];
  topAds: string[];
  fetchedAt: Date;
}

interface OrganicResult {
  position: number;
  title: string;
  url: string;
  description: string;
  domain: string;
  hasFeaturedSnippet: boolean;
}

interface KeywordPlannerData {
  keyword: string;
  avgMonthlySearches: number;
  competition: string;
  cpc: number;
  lowBid: number;
  highBid: number;
  competitionIndex: number;
  trendingUp: boolean;
}

interface ClusterGroup {
  clusterName: string;
  clusterDescription: string;
  keywords: string[];
  relevanceScore: number;
  searchVolumeTotal: number;
  averageDifficulty: number;
}

interface ContentGap {
  topic: string;
  keywords: string[];
  competitorUrls: string[];
  searchVolume: number;
  difficulty: number;
  opportunityScore: number;
  contentAngle: string;
  suggestedHeadlines: string[];
  priority: 'high' | 'medium' | 'low';
  gapType: 'missing_topic' | 'thin_content' | 'outdated' | 'undercovers';
}

interface FindAllFilter {
  page: number;
  limit: number;
  search?: string;
  cluster?: string;
  intent?: string;
  minVolume?: number;
  type?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  projectId?: string;
}

interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ResearchResult {
  topic: string;
  keywords: RawKeyword[];
  totalKeywords: number;
  averageDifficulty: number;
  averageVolume: number;
  totalVolume: number;
  clusters: ClusterGroup[];
  opportunities: RawKeyword[];
  serpData: Record<string, SERPResult>;
  researchId: string;
  generatedAt: Date;
}

// ---------------------------------------------------------------------------
// Keyword difficulty mapping
// ---------------------------------------------------------------------------

const DIFFICULTY_RANGES: Record<string, [number, number]> = {
  very_easy: [0, 14],
  easy: [15, 29],
  medium: [30, 49],
  hard: [50, 69],
  very_hard: [70, 100],
};

const DIFFICULTY_LABELS: Record<string, string> = {
  very_easy: 'Very Easy',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  very_hard: 'Very Hard',
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class KeywordIntelligenceService {
  private readonly logger = new Logger(KeywordIntelligenceService.name);

  private readonly GOOGLE_KEYWORD_PLANNER_API =
    'https://googleads.googleapis.com/v18/customers';

  private readonly CACHE_PREFIX = 'keyword:intel:';
  private readonly DEFAULT_CACHE_TTL = 86_400; // 24 hours
  private readonly SERP_CACHE_TTL = 43_200; // 12 hours

  private readonly COMMON_STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'over', 'after',
    'is', 'it', 'its', 'was', 'were', 'be', 'been', 'being', 'have',
    'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
    'shall', 'should', 'may', 'might', 'must', 'not', 'no', 'nor',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deepseek: DeepSeekService,
    private readonly httpService: HttpService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {}

  // -----------------------------------------------------------------------
  // PUBLIC API METHODS
  // -----------------------------------------------------------------------

  /**
   * Perform comprehensive keyword research for a given topic.
   * Checks semantic cache first, then fetches real data from Google Keyword Planner,
   * SERP data, calls DeepSeek for strategy, enriches, saves, and returns.
   */
  async researchKeywords(
    topic: string,
    options?: KeywordResearchOptions,
  ): Promise<ResearchResult> {
    if (!topic || topic.trim().length === 0) {
      throw new BadRequestException('Topic is required for keyword research');
    }

    const normalizedTopic = topic.trim().toLowerCase();
    const resolvedOptions: KeywordResearchOptions = {
      country: options?.country ?? 'US',
      language: options?.language ?? 'en',
      searchEngine: options?.searchEngine ?? 'google.com',
      includePAA: options?.includePAA ?? true,
      includeRelated: options?.includeRelated ?? true,
      includeQuestions: options?.includeQuestions ?? true,
      includeSERPFeatures: options?.includeSERPFeatures ?? true,
      maxKeywords: options?.maxKeywords ?? 50,
      minVolume: options?.minVolume ?? 0,
      maxDifficulty: options?.maxDifficulty,
      intents: options?.intents,
    };

    const cacheKey = this.buildCacheKey(normalizedTopic, resolvedOptions);
    const researchId = uuidv4();

    // 1. Check semantic cache
    const cached = await this.checkCache<ResearchResult>(cacheKey);
    if (cached) {
      this.logger.log(`Cache hit for keyword research: "${normalizedTopic}"`);
      return cached;
    }

    this.logger.log(
      `Starting keyword research for topic: "${normalizedTopic}" in ${resolvedOptions.country}/${resolvedOptions.language}`,
    );

    try {
      // 2. Fetch SERP data for the main topic
      const serpData: Record<string, SERPResult> = {};
      const mainSERP = await this.fetchSERPData(normalizedTopic, resolvedOptions);
      if (mainSERP) {
        serpData[normalizedTopic] = mainSERP;
      }

      // 3. Build and call DeepSeek for comprehensive keyword strategy
      const deepseekPrompt = this.buildKeywordResearchPrompt(
        normalizedTopic,
        resolvedOptions,
        mainSERP,
      );

      const deepseekResult = await this.deepseek.generateContent(deepseekPrompt, {
        model: 'deepseek-reasoner',
        temperature: 0.4,
        maxTokens: 8192,
        systemPrompt: this.getKeywordResearchSystemPrompt(),
        responseFormat: 'json_object',
      });

      // Parse the keyword response
      const parsed = JSON.parse(deepseekResult.content);
      let keywords: RawKeyword[] = parsed.keywords ?? parsed.primaryKeywords ?? [];

      if (!Array.isArray(keywords) || keywords.length === 0) {
        this.logger.warn(
          `DeepSeek returned no keywords for "${normalizedTopic}". Using fallback generation.`,
        );
        keywords = this.generateFallbackKeywords(normalizedTopic);
      }

      // Extract seed keywords for volume lookup
      const seedKeywords = keywords
        .map((k) => k.keyword)
        .filter(Boolean)
        .slice(0, 100);

      // 4. Fetch search volume from Google Keyword Planner
      const plannerData = await this.fetchFromGoogleKeywordPlanner(
        seedKeywords,
        resolvedOptions,
      );

      // 5. Fetch SERP data for top keywords (async, best-effort)
      const topKeywords = keywords.slice(0, 10).map((k) => k.keyword).filter(Boolean);
      const serpPromises = topKeywords.map(async (kw) => {
        try {
          const serp = await this.fetchSERPData(kw, resolvedOptions);
          if (serp) {
            serpData[kw] = serp;
          }
        } catch {
          // Best-effort SERP fetching
        }
      });
      await Promise.allSettled(serpPromises);

      // 6. Enrich keywords with real data
      const enriched = this.enrichWithRealData(keywords, plannerData, serpData);

      // Apply filters
      const filtered = this.applyKeywordFilters(enriched, resolvedOptions);

      // 7. Save to database
      const saved = await this.saveKeywords(filtered, normalizedTopic, researchId);

      // 8. Build cluster groups from DeepSeek output
      const clusters: ClusterGroup[] = this.buildClustersFromResponse(
        parsed,
        saved,
      );

      // Assemble result
      const result: ResearchResult = {
        topic: normalizedTopic,
        keywords: filtered,
        totalKeywords: filtered.length,
        averageDifficulty: this.calculateAverage(filtered.map((k) => k.difficulty ?? 0)),
        averageVolume: this.calculateAverage(filtered.map((k) => k.searchVolume ?? 0)),
        totalVolume: filtered.reduce((sum, k) => sum + (k.searchVolume ?? 0), 0),
        clusters,
        opportunities: this.identifyOpportunities(filtered),
        serpData,
        researchId,
        generatedAt: new Date(),
      };

      // 9. Cache the result
      await this.setCache(cacheKey, result, this.DEFAULT_CACHE_TTL);

      this.logger.log(
        `Keyword research complete for "${normalizedTopic}": ${result.totalKeywords} keywords, ${clusters.length} clusters`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Keyword research failed for "${normalizedTopic}": ${(error as Error).message}`,
        (error as Error).stack,
      );

      // Return fallback if DeepSeek fails
      const fallbackKeywords = this.generateFallbackKeywords(normalizedTopic);
      const plannerData = await this.fetchFromGoogleKeywordPlanner(
        [normalizedTopic],
        resolvedOptions,
      );
      const enriched = this.enrichWithRealData(fallbackKeywords, plannerData, {});
      const saved = await this.saveKeywords(enriched, normalizedTopic, researchId);

      return {
        topic: normalizedTopic,
        keywords: enriched,
        totalKeywords: enriched.length,
        averageDifficulty: this.calculateAverage(enriched.map((k) => k.difficulty ?? 0)),
        averageVolume: this.calculateAverage(enriched.map((k) => k.searchVolume ?? 0)),
        totalVolume: enriched.reduce((sum, k) => sum + (k.searchVolume ?? 0), 0),
        clusters: [],
        opportunities: this.identifyOpportunities(enriched),
        serpData: {},
        researchId,
        generatedAt: new Date(),
      };
    }
  }

  /**
   * Cluster a set of keywords into semantic groups using DeepSeek.
   */
  async clusterKeywords(
    keywords: string[],
    clusterCount?: number,
  ): Promise<{ clusters: ClusterGroup[]; unclustered: string[] }> {
    if (!keywords || keywords.length === 0) {
      throw new BadRequestException('At least one keyword is required for clustering');
    }

    const effectiveClusterCount = clusterCount ?? Math.min(
      Math.max(Math.round(keywords.length / 5), 3),
      20,
    );

    const cacheKey = `${this.CACHE_PREFIX}cluster:${crypto
      .createHash('md5')
      .update(JSON.stringify({ keywords: [...keywords].sort(), effectiveClusterCount }))
      .digest('hex')}`;

    const cached = await this.checkCache<{ clusters: ClusterGroup[]; unclustered: string[] }>(
      cacheKey,
    );
    if (cached) return cached;

    try {
      const prompt = this.buildClusterPrompt(keywords, effectiveClusterCount);

      const result = await this.deepseek.generateContent(prompt, {
        model: 'deepseek-reasoner',
        temperature: 0.3,
        maxTokens: 4096,
        systemPrompt: this.getClusterSystemPrompt(),
        responseFormat: 'json_object',
      });

      const parsed = JSON.parse(result.content);
      const clusters: ClusterGroup[] = (parsed.clusters ?? parsed.groups ?? []).map(
        (c: any, idx: number) => ({
          clusterName: c.clusterName ?? c.name ?? `Cluster ${idx + 1}`,
          clusterDescription: c.clusterDescription ?? c.description ?? '',
          keywords: c.keywords ?? c.members ?? [],
          relevanceScore: c.relevanceScore ?? c.score ?? 50,
          searchVolumeTotal: c.searchVolumeTotal ?? 0,
          averageDifficulty: c.averageDifficulty ?? 0,
        }),
      );

      const allClustered = new Set(
        clusters.flatMap((c) => c.keywords.map((k) => k.toLowerCase().trim())),
      );
      const unclustered = keywords.filter(
        (k) => !allClustered.has(k.toLowerCase().trim()),
      );

      const output = { clusters, unclustered };
      await this.setCache(cacheKey, output, this.DEFAULT_CACHE_TTL);

      return output;
    } catch (error) {
      this.logger.error(
        `Keyword clustering failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      // Fallback: simple prefix/keyword-based clustering
      const fallbackClusters = this.fallbackClustering(keywords, effectiveClusterCount);
      return { clusters: fallbackClusters, unclustered: [] };
    }
  }

  /**
   * Find content gaps by analyzing competitor content vs. your own.
   */
  async findContentGaps(
    competitorUrls: string[],
    myContent: string[],
    topic?: string,
  ): Promise<{
    gaps: ContentGap[];
    competitorOverlap: number;
    uniqueOpportunities: number;
    summary: string;
  }> {
    if (!competitorUrls || competitorUrls.length === 0) {
      throw new BadRequestException('At least one competitor URL is required');
    }
    if (!myContent || myContent.length === 0) {
      throw new BadRequestException('At least one piece of your own content is required');
    }

    const cacheKey = `${this.CACHE_PREFIX}gaps:${crypto
      .createHash('md5')
      .update(
        JSON.stringify({
          competitors: [...competitorUrls].sort(),
          myContent: [...myContent].sort(),
          topic,
        }),
      )
      .digest('hex')}`;

    const cached = await this.checkCache<{
      gaps: ContentGap[];
      competitorOverlap: number;
      uniqueOpportunities: number;
      summary: string;
    }>(cacheKey);
    if (cached) return cached;

    try {
      const prompt = this.buildContentGapPrompt(competitorUrls, myContent, topic);

      const result = await this.deepseek.generateContent(prompt, {
        model: 'deepseek-reasoner',
        temperature: 0.35,
        maxTokens: 4096,
        systemPrompt: this.getContentGapSystemPrompt(),
        responseFormat: 'json_object',
      });

      const parsed = JSON.parse(result.content);
      const gaps: ContentGap[] = (parsed.gaps ?? parsed.contentGaps ?? []).map(
        (g: any) => ({
          topic: g.topic ?? g.opportunity ?? '',
          keywords: g.keywords ?? [],
          competitorUrls: g.competitorUrls ?? g.urls ?? [],
          searchVolume: g.searchVolume ?? g.volume ?? 0,
          difficulty: g.difficulty ?? g.difficulty ?? 50,
          opportunityScore: g.opportunityScore ?? g.score ?? 50,
          contentAngle: g.contentAngle ?? g.angle ?? '',
          suggestedHeadlines: g.suggestedHeadlines ?? g.headlines ?? [],
          priority: g.priority ?? this.calculateGapPriority(g),
          gapType: g.gapType ?? this.inferGapType(g),
        }),
      );

      const uniqueTopics = new Set(gaps.map((g) => g.topic.toLowerCase()));
      const competitorOverlap = parsed.competitorOverlap ?? 0;
      const summary = parsed.summary ?? parsed.analysis ?? '';

      const output = {
        gaps,
        competitorOverlap,
        uniqueOpportunities: uniqueTopics.size,
        summary,
      };

      await this.setCache(cacheKey, output, this.DEFAULT_CACHE_TTL);

      return output;
    } catch (error) {
      this.logger.error(
        `Content gap analysis failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      return {
        gaps: [],
        competitorOverlap: 0,
        uniqueOpportunities: 0,
        summary: `Gap analysis encountered an error: ${(error as Error).message}. Please try again with fewer URLs.`,
      };
    }
  }

  /**
   * Find all researched keywords with filtering, pagination, and sorting.
   */
  async findAll(filter: FindAllFilter): Promise<PaginatedResult<any>> {
    const where: any = {};

    if (filter.search) {
      where.OR = [
        { term: { contains: filter.search, mode: 'insensitive' } },
        { clusterName: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    if (filter.cluster) {
      where.clusterId = filter.cluster;
    }

    if (filter.intent) {
      where.intent = filter.intent;
    }

    if (filter.type) {
      where.type = filter.type;
    }

    if (filter.minVolume !== undefined) {
      where.searchVolume = { gte: filter.minVolume };
    }

    if (filter.projectId) {
      where.projectId = filter.projectId;
    }

    const page = Math.max(1, filter.page);
    const limit = Math.min(Math.max(1, filter.limit), 200);
    const skip = (page - 1) * limit;

    const orderBy: any = {};
    const sortField = filter.sortBy ?? 'createdAt';
    const sortOrder = filter.sortOrder ?? 'desc';
    orderBy[sortField] = sortOrder;

    try {
      const [data, total] = await Promise.all([
        this.prisma.keyword.findMany({
          where,
          orderBy,
          skip,
          take: limit,
        }),
        this.prisma.keyword.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch keywords: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * Find a single keyword by its ID.
   */
  async findById(id: string): Promise<any> {
    if (!id) {
      throw new BadRequestException('Keyword ID is required');
    }

    const keyword = await this.prisma.keyword.findUnique({
      where: { id },
    });

    if (!keyword) {
      throw new NotFoundException(`Keyword with ID "${id}" not found`);
    }

    return keyword;
  }

  /**
   * Get keyword research statistics.
   */
  async getStats(): Promise<{
    totalKeywords: number;
    totalClusters: number;
    averageVolume: number;
    averageDifficulty: number;
    typeDistribution: Record<string, number>;
    topKeywords: any[];
    clusterDistribution: Array<{ name: string; count: number }>;
  }> {
    const [totalKeywords, keywords, clusterInfo] = await Promise.all([
      this.prisma.keyword.count(),
      this.prisma.keyword.findMany({
        orderBy: { searchVolume: 'desc' },
        take: 20,
      }),
      this.prisma.keyword.groupBy({
        by: ['clusterName', 'clusterId'],
        _count: { id: true },
        where: {
          clusterName: { not: null },
        },
      }),
    ]);

    const typeDistribution = await this.prisma.keyword.groupBy({
      by: ['type'],
      _count: { id: true },
    });

    const volumeAgg = await this.prisma.keyword.aggregate({
      _avg: { searchVolume: true, difficulty: true },
    });

    return {
      totalKeywords,
      totalClusters: clusterInfo.length,
      averageVolume: Math.round(volumeAgg._avg.searchVolume ?? 0),
      averageDifficulty: Math.round(volumeAgg._avg.difficulty ?? 0),
      typeDistribution: typeDistribution.reduce(
        (acc, t) => ({ ...acc, [t.type]: t._count.id }),
        {} as Record<string, number>,
      ),
      topKeywords: keywords,
      clusterDistribution: clusterInfo
        .filter((c) => c.clusterName)
        .map((c) => ({
          name: c.clusterName!,
          count: c._count.id,
        }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // -----------------------------------------------------------------------
  // CACHE HELPERS
  // -----------------------------------------------------------------------

  /**
   * Check the cache for a key. Returns null on miss or error.
   */
  private async checkCache<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.cacheManager.get<T>(key);
      return cached ?? null;
    } catch (error) {
      this.logger.warn(`Cache read error for key "${key}": ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Set a value in the cache with a TTL in seconds.
   */
  private async setCache<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    try {
      await this.cacheManager.set(key, data, ttlSeconds * 1000); // cache-manager uses ms
    } catch (error) {
      this.logger.warn(`Cache write error for key "${key}": ${(error as Error).message}`);
    }
  }

  /**
   * Build a deterministic cache key from research params.
   */
  private buildCacheKey(topic: string, options: KeywordResearchOptions): string {
    const hashInput = JSON.stringify({
      topic: topic.toLowerCase().trim(),
      country: options.country,
      language: options.language,
      searchEngine: options.searchEngine,
      includePAA: options.includePAA,
      includeRelated: options.includeRelated,
      includeQuestions: options.includeQuestions,
      includeSERPFeatures: options.includeSERPFeatures,
      maxKeywords: options.maxKeywords,
      minVolume: options.minVolume,
      maxDifficulty: options.maxDifficulty,
      intents: options.intents ? [...options.intents].sort() : undefined,
    });

    return `${this.CACHE_PREFIX}research:${crypto
      .createHash('sha256')
      .update(hashInput)
      .digest('hex')}`;
  }

  // -----------------------------------------------------------------------
  // GOOGLE KEYWORD PLANNER INTEGRATION
  // -----------------------------------------------------------------------

  /**
   * Fetch search volume data from Google Keyword Planner API.
   * Falls back to mocked data if API is not configured.
   */
  private async fetchFromGoogleKeywordPlanner(
    keywords: string[],
    options: KeywordResearchOptions,
  ): Promise<Map<string, KeywordPlannerData>> {
    if (!keywords || keywords.length === 0) {
      return new Map();
    }

    const clientId = this.configService.get<string>('google.keywordPlanner.clientId');
    const clientSecret = this.configService.get<string>('google.keywordPlanner.clientSecret');
    const developerToken = this.configService.get<string>('google.keywordPlanner.developerToken');
    const customerId = this.configService.get<string>('google.keywordPlanner.customerId');

    if (!clientId || !clientSecret || !developerToken || !customerId) {
      this.logger.warn(
        'Google Keyword Planner API not configured. Using estimated volume data.',
      );
      return this.generateMockKeywordPlannerData(keywords);
    }

    try {
      const accessToken = await this.getGoogleAdsAccessToken(clientId, clientSecret);

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.GOOGLE_KEYWORD_PLANNER_API}/${customerId}/keywordPlanAdGroupKeywords:generate`,
          {
            keywords: keywords.slice(0, 200).map((kw) => ({ text: kw })),
            geoTargetConstants: [
              `geoTargetConstants/${this.getGeoTargetId(options.country ?? 'US')}`,
            ],
            languageConstant: `languageConstants/${this.getLanguageId(options.language ?? 'en')}`,
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'developer-token': developerToken,
              'Content-Type': 'application/json',
              'login-customer-id': customerId,
            },
            timeout: 30000,
          },
        ),
      );

      const resultMap = new Map<string, KeywordPlannerData>();

      for (const row of response.data?.results ?? []) {
        const keyword = row.keyword?.text ?? '';
        const metrics = row.keyword_idea_metrics;

        if (keyword && metrics) {
          resultMap.set(keyword.toLowerCase(), {
            keyword,
            avgMonthlySearches: metrics.avg_monthly_searches ?? 0,
            competition: this.mapCompetitionLevel(metrics.competition),
            cpc: metrics.average_cpc?.micros
              ? metrics.average_cpc.micros / 1_000_000
              : 0,
            lowBid: metrics.low_top_of_page_bid_micros
              ? metrics.low_top_of_page_bid_micros / 1_000_000
              : 0,
            highBid: metrics.high_top_of_page_bid_micros
              ? metrics.high_top_of_page_bid_micros / 1_000_000
              : 0,
            competitionIndex: this.competitionToIndex(metrics.competition),
            trendingUp: false,
          });
        }
      }

      if (resultMap.size === 0) {
        this.logger.warn('Google Keyword Planner returned no results. Using estimated data.');
        return this.generateMockKeywordPlannerData(keywords);
      }

      this.logger.log(
        `Google Keyword Planner returned data for ${resultMap.size}/${keywords.length} keywords`,
      );
      return resultMap;
    } catch (error) {
      this.logger.error(
        `Google Keyword Planner API error: ${(error as Error).message}. Using estimated volume data.`,
      );
      return this.generateMockKeywordPlannerData(keywords);
    }
  }

  /**
   * Get Google Ads OAuth2 access token.
   */
  private async getGoogleAdsAccessToken(
    clientId: string,
    clientSecret: string,
  ): Promise<string> {
    const refreshToken = this.configService.get<string>('google.keywordPlanner.refreshToken');

    if (!refreshToken) {
      throw new Error('Google Ads refresh token not configured');
    }

    const response = await firstValueFrom(
      this.httpService.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        },
      ),
    );

    return response.data?.access_token ?? '';
  }

  /**
   * Map country code to Google Ads geo target constant ID.
   */
  private getGeoTargetId(country: string): string {
    const geoMap: Record<string, string> = {
      US: '2840',
      GB: '2826',
      CA: '2124',
      AU: '2036',
      IN: '2356',
      DE: '2276',
      FR: '2250',
      JP: '2392',
      BR: '2076',
      MX: '2484',
    };
    return geoMap[country.toUpperCase()] ?? '2840';
  }

  /**
   * Map language code to Google Ads language constant ID.
   */
  private getLanguageId(language: string): string {
    const langMap: Record<string, string> = {
      en: '1000',
      es: '1015',
      fr: '1018',
      de: '1016',
      ja: '1036',
      pt: '1014',
      hi: '1025',
    };
    return langMap[language.toLowerCase()] ?? '1000';
  }

  /**
   * Map Google competition enum to human-readable level.
   */
  private mapCompetitionLevel(competition: string): string {
    switch (competition) {
      case 'LOW':
        return 'low';
      case 'MEDIUM':
        return 'medium';
      case 'HIGH':
        return 'high';
      default:
        return 'unknown';
    }
  }

  /**
   * Convert competition enum to numeric index (0.0 - 1.0).
   */
  private competitionToIndex(competition: string): number {
    switch (competition) {
      case 'LOW':
        return 0.2;
      case 'MEDIUM':
        return 0.5;
      case 'HIGH':
        return 0.85;
      default:
        return 0.5;
    }
  }

  /**
   * Generate plausible mock keyword planner data when the API is not configured.
   * Uses a deterministic seed based on the keyword text to produce consistent results.
   */
  private generateMockKeywordPlannerData(
    keywords: string[],
  ): Map<string, KeywordPlannerData> {
    const resultMap = new Map<string, KeywordPlannerData>();

    for (const keyword of keywords) {
      const normalized = keyword.toLowerCase().trim();
      if (!normalized) continue;

      // Deterministic hash-based seed
      const hash = crypto.createHash('md5').update(normalized).digest('hex');
      const seed = parseInt(hash.substring(0, 8), 16);

      // Generate volume: higher for shorter/common keywords
      const wordCount = normalized.split(/\s+/).length;
      const volumeBase =
        wordCount === 1
          ? 15000
          : wordCount === 2
            ? 5000
            : wordCount === 3
              ? 1500
              : 400;
      const volumeVariation = (seed % 500) - 250;
      const avgMonthlySearches = Math.max(10, volumeBase + volumeVariation);

      // Competition level
      const competitionRand = (seed >> 8) % 100;
      const competition =
        competitionRand < 33 ? 'low' : competitionRand < 66 ? 'medium' : 'high';

      // CPC: based on competition
      const cpcBase = competition === 'high' ? 3.5 : competition === 'medium' ? 1.8 : 0.75;
      const cpcVariation = ((seed >> 16) % 100) / 100 - 0.5;
      const cpc = Math.max(0.1, parseFloat((cpcBase + cpcVariation).toFixed(2)));

      resultMap.set(normalized, {
        keyword,
        avgMonthlySearches,
        competition,
        cpc,
        lowBid: Math.max(0.05, cpc * 0.4),
        highBid: Math.max(0.1, cpc * 1.8),
        competitionIndex:
          competition === 'high' ? 0.85 : competition === 'medium' ? 0.5 : 0.2,
        trendingUp: (seed >> 24) % 2 === 0,
      });
    }

    this.logger.debug(
      `Generated mock keyword planner data for ${resultMap.size} keywords`,
    );
    return resultMap;
  }

  // -----------------------------------------------------------------------
  // SERP DATA FETCHING
  // -----------------------------------------------------------------------

  /**
   * Fetch SERP (Search Engine Results Page) data for a given keyword.
   * Uses a configurable SERP API (e.g., SerpAPI, Google Custom Search, etc.)
   * Falls back to basic estimation if no SERP API is configured.
   */
  private async fetchSERPData(
    keyword: string,
    options: KeywordResearchOptions,
  ): Promise<SERPResult | null> {
    if (!keyword || keyword.trim().length === 0) return null;

    const cacheKey = `${this.CACHE_PREFIX}serp:${crypto
      .createHash('md5')
      .update(keyword.toLowerCase().trim())
      .digest('hex')}`;

    const cached = await this.checkCache<SERPResult>(cacheKey);
    if (cached) return cached;

    const serpApiKey = this.configService.get<string>('serp.apiKey');
    const googleCx = this.configService.get<string>('serp.googleCx');
    const useSerpApi = serpApiKey && googleCx;

    try {
      let serpResult: SERPResult;

      if (useSerpApi) {
        serpResult = await this.fetchSERPFromApi(
          keyword,
          options,
          serpApiKey!,
          googleCx!,
        );
      } else {
        serpResult = this.generateMockSERPData(keyword);
      }

      await this.setCache(cacheKey, serpResult, this.SERP_CACHE_TTL);
      return serpResult;
    } catch (error) {
      this.logger.warn(
        `SERP fetch failed for "${keyword}": ${(error as Error).message}. Using mock data.`,
      );
      const mockResult = this.generateMockSERPData(keyword);
      return mockResult;
    }
  }

  /**
   * Fetch SERP data from Google Custom Search API or similar.
   */
  private async fetchSERPFromApi(
    keyword: string,
    options: KeywordResearchOptions,
    apiKey: string,
    cx: string,
  ): Promise<SERPResult> {
    const response = await firstValueFrom(
      this.httpService.get('https://www.googleapis.com/customsearch/v1', {
        params: {
          q: keyword,
          cx,
          key: apiKey,
          gl: options.country ?? 'US',
          hl: options.language ?? 'en',
          num: 10,
        },
        timeout: 15000,
      }),
    );

    const data = response.data;
    const items: any[] = data.items ?? [];

    const organicResults: OrganicResult[] = items.map((item: any, idx: number) => ({
      position: idx + 1,
      title: item.title ?? '',
      url: item.link ?? '',
      description: item.snippet ?? '',
      domain: this.extractDomain(item.link ?? ''),
      hasFeaturedSnippet: false,
    }));

    // Extract PAA (People Also Ask) from the HTML if available
    const paaQuestions: string[] = [];
    const relatedSearches: string[] = [];

    // PAA and related searches are not available via Custom Search API directly
    // We rely on DeepSeek to generate these instead

    return {
      keyword,
      totalResults: data.searchInformation?.totalResults
        ? parseInt(data.searchInformation.totalResults, 10)
        : 0,
      organicResults,
      features: [],
      paaQuestions,
      relatedSearches,
      topAds: [],
      fetchedAt: new Date(),
    };
  }

  /**
   * Generate mock SERP data when no SERP API is configured.
   * Produces realistic-looking organic results based on the keyword.
   */
  private generateMockSERPData(keyword: string): SERPResult {
    const wordCount = keyword.split(/\s+/).length;
    const domainTypes = ['.com', '.org', '.io', '.co', '.net'];
    const domains = [
      'example',
      'guide',
      'resource',
      'learn',
      'hub',
      'insider',
      'central',
      'today',
      'experts',
      'academy',
    ];

    const organicResults: OrganicResult[] = Array.from({ length: 10 }, (_, i) => {
      const domain = `${domains[i % domains.length]}${domainTypes[i % domainTypes.length]}`;
      return {
        position: i + 1,
        title: `${keyword} - ${i === 0 ? 'Ultimate Guide' : i < 3 ? 'Complete Overview' : i < 6 ? 'Best Practices & Tips' : 'Resources & Tools'} (${new Date().getFullYear()})`,
        url: `https://www.${domain}/${keyword.replace(/\s+/g, '-').toLowerCase()}`,
        description: `Comprehensive ${keyword} resource. Learn everything you need to know about ${keyword} including strategies, tools, expert insights, and actionable tips for ${new Date().getFullYear()}.`,
        domain,
        hasFeaturedSnippet: i === 0,
      };
    });

    // Simulate total results based on keyword length
    const totalResults = wordCount === 1
      ? Math.floor(Math.random() * 900_000_000) + 100_000_000
      : wordCount === 2
        ? Math.floor(Math.random() * 50_000_000) + 5_000_000
        : wordCount <= 4
          ? Math.floor(Math.random() * 2_000_000) + 100_000
          : Math.floor(Math.random() * 50_000) + 1_000;

    return {
      keyword,
      totalResults,
      organicResults,
      features: [],
      paaQuestions: [],
      relatedSearches: [],
      topAds: [],
      fetchedAt: new Date(),
    };
  }

  /**
   * Extract domain from a URL string.
   */
  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  // -----------------------------------------------------------------------
  // DEEPSEEK PROMPT BUILDERS
  // -----------------------------------------------------------------------

  /**
   * System prompt for the keyword research task.
   */
  private getKeywordResearchSystemPrompt(): string {
    return `You are a world-class SEO keyword research analyst and content strategist with deep expertise in semantic search, NLP, and modern SEO practices.

Your role is to generate a comprehensive, data-driven keyword strategy for any given topic. You must think like both an SEO specialist and a content strategist, identifying not just obvious keywords but also latent semantic relationships, question-based queries, and emerging topic clusters.

Key principles:
- Think in terms of topic clusters and semantic relevance, not just exact-match keywords
- Consider search intent at each level (informational, navigational, commercial, transactional)
- Identify People Also Ask (PAA) opportunities and featured snippet potential
- Surface long-tail variations that indicate buying intent or specific informational needs
- Recognize keyword relationships and topical hierarchies
- Suggest keywords that balance search volume with ranking difficulty

Output ONLY valid JSON matching the requested format. Be thorough and precise.`;
  }

  /**
   * Build the complete keyword research prompt for DeepSeek.
   */
  private buildKeywordResearchPrompt(
    topic: string,
    options: KeywordResearchOptions,
    serpData?: SERPResult | null,
  ): string {
    const maxKeywords = options.maxKeywords ?? 50;

    const sections: string[] = [
      `Generate a comprehensive keyword strategy for the topic: "${topic}"`,
      '',
      `Target Country: ${options.country}`,
      `Target Language: ${options.language}`,
      `Search Engine: ${options.searchEngine}`,
      `Maximum Keywords: ${maxKeywords}`,
      '',
    ];

    if (serpData && serpData.organicResults.length > 0) {
      sections.push('Current SERP Landscape (top results for this topic):');
      sections.push(
        serpData.organicResults.slice(0, 5).map(
          (r, i) =>
            `  ${i + 1}. ${r.title} (${r.domain}) - ${r.description.substring(0, 120)}`,
        ).join('\n'),
      );
      sections.push('');
    }

    sections.push('For each keyword, provide the following fields:');
    sections.push('1. keyword: The exact keyword phrase');
    sections.push('2. type: One of: primary, secondary, long_tail, semantic, lsi, question');
    sections.push('3. intent: One of: informational, navigational, commercial, transactional');
    sections.push('4. relatedKeywords: Array of 3-7 semantically related keyword phrases');
    sections.push('5. questions: Array of question-based variations (what, why, how, when, where, which)');
    sections.push('6. paaItems: Array of People Also Ask questions this keyword could target');
    sections.push('7. serpFeatures: Array of possible SERP features (featured_snippet, knowledge_panel, local_pack, image_pack, video, people_also_ask, related_searches)');
    sections.push('8. clusterName: The topic cluster this keyword belongs to');
    sections.push('9. difficulty: Estimated ranking difficulty score from 0-100');
    sections.push('10. trend: Current momentum: rising, stable, declining, seasonal');
    sections.push('');

    if (options.includePAA) {
      sections.push('Include PAA (People Also Ask) data for the main keyword and its variations.');
    }

    if (options.includeRelated) {
      sections.push('Include related searches and semantically connected keyword phrases.');
    }

    if (options.includeQuestions) {
      sections.push('Include question-based keywords covering who, what, when, where, why, how, which, are, do, does, can, will, is.');
    }

    sections.push('');
    sections.push('CRITICAL: Organize the output into the following JSON structure:');
    sections.push(`{
  "topic": "${topic}",
  "keywords": [
    {
      "keyword": "string",
      "type": "primary|secondary|long_tail|semantic|lsi|question",
      "intent": "informational|navigational|commercial|transactional",
      "relatedKeywords": ["string"],
      "questions": ["string"],
      "paaItems": ["string"],
      "serpFeatures": ["string"],
      "clusterName": "string",
      "difficulty": "number (0-100)",
      "trend": "rising|stable|declining|seasonal"
    }
  ],
  "clusters": [
    {
      "clusterName": "string",
      "clusterDescription": "string",
      "keywords": ["string"],
      "searchVolumeTotal": "number",
      "averageDifficulty": "number",
      "relevanceScore": "number (0-100)"
    }
  ],
  "summary": "string - A brief analysis of the keyword landscape for this topic"
}`);

    sections.push('');
    sections.push(`Generate at least ${Math.min(maxKeywords, 20)} keywords, up to ${maxKeywords}. Prioritize quality and relevance over quantity.`);

    return sections.join('\n');
  }

  /**
   * System prompt for the clustering task.
   */
  private getClusterSystemPrompt(): string {
    return `You are an expert in semantic keyword clustering and topic modeling. Your role is to group keywords into meaningful, coherent clusters based on semantic similarity, search intent, and topical relationships.

For each cluster, you must:
1. Identify the core theme that unifies the keywords
2. Assign a descriptive, human-readable cluster name
3. Provide a brief description of what the cluster covers
4. Score the relevance of the cluster (0-100)
5. Order clusters by importance/relevance

Think about:
- Latent semantic indexing (LSI) relationships
- Search intent (informational, commercial, navigational, transactional)
- Topic hierarchies and parent-child relationships
- Keyword co-occurrence patterns and topical proximity

Output ONLY valid JSON.`;
  }

  /**
   * Build the clustering prompt.
   */
  private buildClusterPrompt(
    keywords: string[],
    clusterCount: number,
  ): string {
    const sortedKeywords = [...new Set(keywords.map((k) => k.trim().toLowerCase()))].filter(
      Boolean,
    );

    return `Group the following ${sortedKeywords.length} keywords into exactly ${clusterCount} semantic clusters.

Keywords:
${sortedKeywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

Output format:
{
  "clusters": [
    {
      "clusterName": "string - A descriptive name for this cluster",
      "clusterDescription": "string - What this cluster represents",
      "keywords": ["string - member keywords from the input list"],
      "relevanceScore": "number (0-100)",
      "searchVolumeTotal": "number (estimate total volume if possible)",
      "averageDifficulty": "number (0-100, estimate average difficulty)"
    }
  ]
}

Requirements:
- Each keyword must be assigned to exactly one cluster
- Create exactly ${clusterCount} clusters
- Cluster names should be descriptive and content-strategy friendly
- Order clusters by estimated relevance to the overall keyword set`;
  }

  /**
   * System prompt for content gap analysis.
   */
  private getContentGapSystemPrompt(): string {
    return `You are an expert content strategist and competitive analyst. Your role is to identify content gaps by comparing competitor content against a client's existing content.

Look for:
- Topics competitors cover thoroughly that the client has not addressed
- Keywords competitors rank for that the client does not
- Content formats and angles competitors use successfully
- Underserved subtopics within the broader niche
- Questions competitors answer that the client's content ignores
- Thin content opportunities where competitors have superficial coverage

For each gap found, assess:
- Opportunity score based on search volume potential and competition level
- Suggested content angle that differentiates from competitors
- Priority based on strategic importance and business value
- Gap type classification

Output ONLY valid JSON. Be specific and actionable.`;
  }

  /**
   * Build the content gap analysis prompt.
   */
  private buildContentGapPrompt(
    competitorUrls: string[],
    myContent: string[],
    topic?: string,
  ): string {
    const sections: string[] = [];

    sections.push('Perform a detailed content gap analysis between competitor content and our content.');
    sections.push('');

    if (topic) {
      sections.push(`Focus Topic: "${topic}"`);
      sections.push('');
    }

    sections.push('Competitor Content (URLs/Titles):');
    competitorUrls.forEach((url, i) => sections.push(`  ${i + 1}. ${url}`));
    sections.push('');

    sections.push('Our Existing Content (URLs/Titles):');
    myContent.forEach((url, i) => sections.push(`  ${i + 1}. ${url}`));
    sections.push('');

    sections.push(`Analyze the competitor content and our content to identify gaps where:
1. Competitors have substantial content on topics we don't cover at all (missing_topic)
2. Competitors have more comprehensive content on topics we only briefly mention (thin_content)
3. Competitors have newer/updated content on topics where our content is outdated (outdated)
4. Competitors are covering subtopics or angles we haven't explored (undercovers)`);

    sections.push('');
    sections.push('Output format:');
    sections.push(`{
  "gaps": [
    {
      "topic": "string - The topic or keyword opportunity",
      "keywords": ["string - Related keywords/keyphrases"],
      "competitorUrls": ["string - Which competitor URLs cover this"],
      "searchVolume": "number - Estimated monthly search volume",
      "difficulty": "number - Estimated ranking difficulty (0-100)",
      "opportunityScore": "number - Overall opportunity score (0-100)",
      "contentAngle": "string - Suggested unique angle to differentiate",
      "suggestedHeadlines": ["string - 3-5 potential headlines"],
      "priority": "high|medium|low",
      "gapType": "missing_topic|thin_content|outdated|undercovers"
    }
  ],
  "competitorOverlap": "number - Percentage of topics competitors cover that we also cover",
  "summary": "string - Overall analysis summary with recommendations"
}`);

    return sections.join('\n');
  }

  // -----------------------------------------------------------------------
  // KEYWORD ENRICHMENT
  // -----------------------------------------------------------------------

  /**
   * Enrich keyword data with real search volume, CPC, and competition data
   * from Google Keyword Planner, plus SERP insights.
   */
  private enrichWithRealData(
    keywords: RawKeyword[],
    plannerData: Map<string, KeywordPlannerData>,
    serpData: Record<string, SERPResult>,
  ): RawKeyword[] {
    return keywords.map((kw) => {
      const normalized = kw.keyword.toLowerCase().trim();
      const planner = plannerData.get(normalized);
      const serp = serpData[normalized];

      const searchVolume = planner?.avgMonthlySearches ?? kw.searchVolume;
      const cpc = planner?.cpc ?? kw.cpc;
      const competition = planner?.competition ?? kw.competition;

      // Calculate difficulty: blend planner competition index with length-based estimate
      const plannerDifficulty = planner
        ? this.competitionToDifficulty(planner.competitionIndex)
        : null;
      const lengthDifficulty = this.estimateDifficultyByLength(normalized);
      const difficulty = kw.difficulty ?? plannerDifficulty ?? lengthDifficulty;

      // Opportunity score: higher volume + lower difficulty = better opportunity
      const opportunityScore = this.calculateOpportunityScore(
        searchVolume ?? 0,
        difficulty,
        competition,
      );

      // Extract PAA questions from SERP data
      const paaItems = [
        ...new Set([
          ...(kw.paaItems ?? []),
          ...(serp?.paaQuestions ?? []),
        ]),
      ];

      // Merge related searches
      const relatedKeywords = [
        ...new Set([
          ...(kw.relatedKeywords ?? []),
          ...(serp?.relatedSearches ?? []),
        ]),
      ];

      return {
        ...kw,
        searchVolume: searchVolume ?? 0,
        cpc: cpc ?? 0,
        competition,
        difficulty,
        opportunityScore,
        paaItems,
        relatedKeywords,
        serpFeatures: [
          ...new Set([
            ...(kw.serpFeatures ?? []),
            ...(serp?.features.map((f) => f.type) ?? []),
          ]),
        ],
        trend: kw.trend ?? this.estimateTrend(searchVolume ?? 0, normalized),
      };
    });
  }

  /**
   * Convert the planner competition index (0.0-1.0) to a difficulty score (0-100).
   */
  private competitionToDifficulty(competitionIndex: number): number {
    return Math.min(100, Math.round(competitionIndex * 100));
  }

  /**
   * Estimate difficulty based on keyword length (more words = typically easier).
   */
  private estimateDifficultyByLength(keyword: string): number {
    const wordCount = keyword.split(/\s+/).length;
    if (wordCount === 1) return Math.floor(Math.random() * 20) + 60; // 60-80
    if (wordCount === 2) return Math.floor(Math.random() * 25) + 40; // 40-65
    if (wordCount === 3) return Math.floor(Math.random() * 20) + 25; // 25-45
    return Math.floor(Math.random() * 15) + 10; // 10-25
  }

  /**
   * Calculate opportunity score based on volume, difficulty, and competition.
   */
  private calculateOpportunityScore(
    volume: number,
    difficulty: number,
    competition?: string,
  ): number {
    const volumeScore = volume > 10000 ? 30 : volume > 1000 ? 20 : volume > 100 ? 10 : 5;
    const difficultyScore = Math.max(0, 100 - difficulty) * 0.4;
    const competitionScore =
      competition === 'low' ? 20 : competition === 'medium' ? 10 : competition === 'high' ? 0 : 10;

    return Math.min(100, Math.round(volumeScore + difficultyScore + competitionScore));
  }

  /**
   * Estimate keyword trend direction based on volume and characteristics.
   */
  private estimateTrend(volume: number, keyword: string): string {
    // Check for seasonal terms
    const seasonalTerms = [
      'christmas', 'halloween', 'summer', 'winter', 'spring', 'fall',
      'holiday', 'new year', 'valentine', 'thanksgiving',
    ];
    const isSeasonal = seasonalTerms.some((t) => keyword.includes(t));
    if (isSeasonal) return 'seasonal';

    // Rising keywords tend to be longer-tail, newer concepts
    if (volume > 0 && volume < 1000) return 'rising';

    if (volume > 100000) return 'stable';

    return 'stable';
  }

  /**
   * Apply post-enrichment filters based on user options.
   */
  private applyKeywordFilters(
    keywords: RawKeyword[],
    options: KeywordResearchOptions,
  ): RawKeyword[] {
    let filtered = [...keywords];

    // Filter by minimum volume
    if (options.minVolume && options.minVolume > 0) {
      filtered = filtered.filter((k) => (k.searchVolume ?? 0) >= options.minVolume!);
    }

    // Filter by max difficulty
    if (options.maxDifficulty) {
      const [minDiff, maxDiff] = DIFFICULTY_RANGES[options.maxDifficulty] ?? [0, 100];
      filtered = filtered.filter((k) => {
        const diff = k.difficulty ?? 50;
        return diff >= minDiff && diff <= maxDiff;
      });
    }

    // Filter by intents
    if (options.intents && options.intents.length > 0) {
      filtered = filtered.filter((k) =>
        options.intents!.includes(k.intent ?? 'informational'),
      );
    }

    // Limit total keywords
    const maxKeywords = options.maxKeywords ?? 50;
    if (filtered.length > maxKeywords) {
      // Sort by opportunity score descending, then take top N
      filtered.sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0));
      filtered = filtered.slice(0, maxKeywords);
    }

    return filtered;
  }

  // -----------------------------------------------------------------------
  // KEYWORD PERSISTENCE
  // -----------------------------------------------------------------------

  /**
   * Save enriched keywords to the database via Prisma.
   * Upserts by keyword term to avoid duplicates.
   */
  private async saveKeywords(
    keywords: RawKeyword[],
    topic: string,
    researchId: string,
  ): Promise<any[]> {
    const saved: any[] = [];

    // Find or create a project for this topic
    const projectSlug = `research-${topic.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;

    let project = await this.prisma.project.findFirst({
      where: { slug: projectSlug },
    });

    if (!project) {
      project = await this.prisma.project.create({
        data: {
          name: `Research: ${topic}`,
          slug: projectSlug,
          status: 'ACTIVE',
          organizationId: (await this.getDefaultOrganization())?.id ?? '',
          userId: '', // Will be associated when user context is available
        },
      });
    }

    for (const kw of keywords) {
      try {
        const term = kw.keyword?.trim();
        if (!term) continue;

        const keywordData = {
          term,
          type: this.mapKeywordType(kw.type),
          searchVolume: kw.searchVolume ?? null,
          difficulty: kw.difficulty ?? null,
          cpc: kw.cpc ?? null,
          intent: kw.intent ?? null,
          priority: this.calculatePriority(kw),
          clusterName: kw.clusterName ?? null,
          clusterId: kw.clusterId ?? null,
          opportunityScore: kw.opportunityScore ?? null,
          projectId: project.id,
        };

        // Upsert to avoid duplicates
        const existing = await this.prisma.keyword.findFirst({
          where: { term, projectId: project.id },
        });

        let savedKeyword: any;
        if (existing) {
          savedKeyword = await this.prisma.keyword.update({
            where: { id: existing.id },
            data: {
              ...keywordData,
              searchVolume: keywordData.searchVolume ?? existing.searchVolume,
              difficulty: keywordData.difficulty ?? existing.difficulty,
              cpc: keywordData.cpc ?? existing.cpc,
              opportunityScore: Math.max(
                keywordData.opportunityScore ?? 0,
                existing.opportunityScore ?? 0,
              ),
            },
          });
        } else {
          savedKeyword = await this.prisma.keyword.create({
            data: keywordData,
          });
        }

        saved.push(savedKeyword);
      } catch (error) {
        this.logger.error(
          `Failed to save keyword "${kw.keyword}": ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(`Saved ${saved.length}/${keywords.length} keywords for topic "${topic}"`);
    return saved;
  }

  /**
   * Map string keyword type to Prisma KeywordType enum.
   */
  private mapKeywordType(type: string): any {
    const typeMap: Record<string, any> = {
      primary: 'PRIMARY',
      secondary: 'SECONDARY',
      long_tail: 'LONG_TAIL',
      'long-tail': 'LONG_TAIL',
      longtail: 'LONG_TAIL',
      semantic: 'SEMANTIC',
      lsi: 'LSI',
      question: 'QUESTION',
    };
    return typeMap[type?.toLowerCase()] ?? 'PRIMARY';
  }

  /**
   * Calculate keyword priority score (0 = highest priority).
   */
  private calculatePriority(kw: RawKeyword): number {
    let priority = 5;

    // Higher volume = higher priority (lower number)
    if (kw.searchVolume && kw.searchVolume > 10000) priority -= 3;
    else if (kw.searchVolume && kw.searchVolume > 1000) priority -= 2;
    else if (kw.searchVolume && kw.searchVolume > 100) priority -= 1;

    // Lower difficulty = higher priority
    if (kw.difficulty !== undefined) {
      if (kw.difficulty < 30) priority -= 2;
      else if (kw.difficulty < 50) priority -= 1;
      else if (kw.difficulty > 70) priority += 2;
    }

    // Primary keywords get higher priority
    if (kw.type === 'primary') priority -= 2;
    if (kw.type === 'secondary') priority -= 1;

    // Commercial/transactional intent often has higher value
    if (kw.intent === 'transactional' || kw.intent === 'commercial') priority -= 1;

    return Math.max(1, Math.min(10, priority));
  }

  /**
   * Get the default organization for the platform.
   */
  private async getDefaultOrganization(): Promise<{ id: string } | null> {
    try {
      const org = await this.prisma.organization.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      });
      return org ? { id: org.id } : null;
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // CLUSTER BUILDING
  // -----------------------------------------------------------------------

  /**
   * Build cluster groups from the DeepSeek response's cluster data.
   */
  private buildClustersFromResponse(
    parsed: any,
    savedKeywords: any[],
  ): ClusterGroup[] {
    const clusters: ClusterGroup[] = (parsed.clusters ?? []).map((c: any) => ({
      clusterName: c.clusterName ?? 'Unnamed Cluster',
      clusterDescription: c.clusterDescription ?? '',
      keywords: c.keywords ?? [],
      relevanceScore: c.relevanceScore ?? 50,
      searchVolumeTotal: c.searchVolumeTotal ?? 0,
      averageDifficulty: c.averageDifficulty ?? 0,
    }));

    // If DeepSeek did not provide clusters, create them from keyword cluster names
    if (clusters.length === 0) {
      const clusterMap = new Map<string, string[]>();
      for (const kw of savedKeywords) {
        const name = kw.clusterName ?? 'General';
        if (!clusterMap.has(name)) {
          clusterMap.set(name, []);
        }
        clusterMap.get(name)!.push(kw.term);
      }

      for (const [name, members] of clusterMap) {
        clusters.push({
          clusterName: name,
          clusterDescription: '',
          keywords: members,
          relevanceScore: 50,
          searchVolumeTotal: 0,
          averageDifficulty: 0,
        });
      }
    }

    // Compute total volume and average difficulty per cluster
    for (const cluster of clusters) {
      let totalVolume = 0;
      let totalDifficulty = 0;
      let countWithVolume = 0;
      let countWithDifficulty = 0;

      for (const kw of savedKeywords) {
        if (cluster.keywords.includes(kw.term) || kw.clusterName === cluster.clusterName) {
          if (kw.searchVolume) {
            totalVolume += kw.searchVolume;
            countWithVolume++;
          }
          if (kw.difficulty) {
            totalDifficulty += kw.difficulty;
            countWithDifficulty++;
          }
        }
      }

      cluster.searchVolumeTotal = totalVolume;
      cluster.averageDifficulty =
        countWithDifficulty > 0 ? Math.round(totalDifficulty / countWithDifficulty) : 0;
    }

    return clusters;
  }

  /**
   * Fallback clustering when DeepSeek is unavailable.
   * Uses simple keyword overlap and common-word matching.
   */
  private fallbackClustering(
    keywords: string[],
    clusterCount: number,
  ): ClusterGroup[] {
    const normalized = keywords.map((k) => ({
      original: k,
      normalized: k.toLowerCase().trim(),
      words: k
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 2 && !this.COMMON_STOP_WORDS.has(w)),
    }));

    // Simple clustering by shared significant words
    const wordMap = new Map<string, Set<string>>();
    for (const item of normalized) {
      for (const word of item.words) {
        if (!wordMap.has(word)) {
          wordMap.set(word, new Set());
        }
        wordMap.get(word)!.add(item.original);
      }
    }

    // Take the top N most-connected words as cluster centers
    const sortedWords = [...wordMap.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, clusterCount);

    const clusters: ClusterGroup[] = [];
    const assigned = new Set<string>();

    for (let i = 0; i < sortedWords.length; i++) {
      const [word, members] = sortedWords[i];
      const uniqueMembers = [...members].filter((m) => {
        if (assigned.has(m.toLowerCase())) return false;
        assigned.add(m.toLowerCase());
        return true;
      });

      if (uniqueMembers.length > 0) {
        clusters.push({
          clusterName: this.toTitleCase(word),
          clusterDescription: `Keywords related to "${word}"`,
          keywords: uniqueMembers,
          relevanceScore: Math.round((uniqueMembers.length / keywords.length) * 100),
          searchVolumeTotal: 0,
          averageDifficulty: 0,
        });
      }
    }

    // Add remaining unassigned keywords to the most relevant cluster
    const unassigned = keywords.filter((k) => !assigned.has(k.toLowerCase()));
    if (unassigned.length > 0 && clusters.length > 0) {
      clusters[0].keywords.push(...unassigned);
    }

    return clusters;
  }

  // -----------------------------------------------------------------------
  // CONTENT GAP HELPERS
  // -----------------------------------------------------------------------

  /**
   * Calculate priority for a content gap.
   */
  private calculateGapPriority(gap: any): 'high' | 'medium' | 'low' {
    const score = gap.opportunityScore ?? gap.score ?? 50;
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }

  /**
   * Infer the gap type from the gap data.
   */
  private inferGapType(gap: any): ContentGap['gapType'] {
    if (gap.gapType) return gap.gapType as ContentGap['gapType'];
    if (gap.missingTopic) return 'missing_topic';
    if (gap.thinContent) return 'thin_content';
    return 'missing_topic';
  }

  // -----------------------------------------------------------------------
  // OPPORTUNITY IDENTIFICATION
  // -----------------------------------------------------------------------

  /**
   * Identify the best keyword opportunities from a set of keywords.
   */
  private identifyOpportunities(keywords: RawKeyword[]): RawKeyword[] {
    return keywords
      .filter((k) => {
        const volume = k.searchVolume ?? 0;
        const difficulty = k.difficulty ?? 100;
        const score = k.opportunityScore ?? 0;
        return volume >= 100 && difficulty <= 60 && score >= 50;
      })
      .sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0))
      .slice(0, 15);
  }

  // -----------------------------------------------------------------------
  // FALLBACK GENERATORS
  // -----------------------------------------------------------------------

  /**
   * Generate fallback keywords when DeepSeek is unavailable.
   * Uses a combination of keyword expansion techniques.
   */
  private generateFallbackKeywords(topic: string): RawKeyword[] {
    const words = topic
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    const keywords: RawKeyword[] = [];
    const seen = new Set<string>();

    // Helper to add unique keywords
    const addKeyword = (
      keyword: string,
      type: string,
      intent: string,
      difficulty: number,
    ) => {
      const normalized = keyword.toLowerCase().trim();
      if (seen.has(normalized) || normalized.length < 3) return;
      seen.add(normalized);

      const wordCount = normalized.split(/\s+/).length;
      const volumeBase = wordCount <= 2 ? 5000 : wordCount <= 3 ? 1500 : 300;
      const volume = Math.max(10, volumeBase + Math.floor(Math.random() * volumeBase));

      keywords.push({
        keyword: normalized,
        type,
        searchVolume: volume,
        cpc: Math.max(0.1, parseFloat((Math.random() * 3 + 0.5).toFixed(2))),
        competition: difficulty < 40 ? 'low' : difficulty < 65 ? 'medium' : 'high',
        difficulty,
        intent,
        trend: difficulty < 40 ? 'rising' : 'stable',
        relatedKeywords: [],
        questions: [],
        paaItems: [],
        serpFeatures: [],
        opportunityScore: this.calculateOpportunityScore(volume, difficulty, 'medium'),
      });
    };

    // 1. Primary keyword (the topic itself)
    addKeyword(topic, 'primary', 'informational', Math.floor(Math.random() * 20) + 55);

    // 2. Secondary: add modifiers
    const modifiers = ['best', 'top', 'guide', 'tutorial', 'tips', 'review', 'vs', 'examples'];
    for (const mod of modifiers) {
      addKeyword(
        `${mod} ${topic}`,
        'secondary',
        mod === 'best' || mod === 'top' ? 'commercial' : 'informational',
        Math.floor(Math.random() * 25) + 30,
      );
    }

    // 3. Long-tail variations
    const longTailPrefixes = [
      'how to',
      'what is',
      'why is',
      'when to',
      'where to find',
      'how much does',
      'how often should',
      'what are the benefits of',
      'how to choose',
      'step by step',
    ];
    for (const prefix of longTailPrefixes) {
      addKeyword(
        `${prefix} ${topic}`,
        'long_tail',
        prefix.startsWith('how') ? 'informational' : 'informational',
        Math.floor(Math.random() * 20) + 10,
      );
    }

    // 4. LSI / Semantic keywords
    if (words.length > 0) {
      const lsiSuffixes = ['meaning', 'definition', 'basics', 'overview', 'fundamentals'];
      for (const suffix of lsiSuffixes) {
        addKeyword(
          `${topic} ${suffix}`,
          'lsi',
          'informational',
          Math.floor(Math.random() * 15) + 15,
        );
      }

      // Semantic combinations of topic words
      for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j < words.length; j++) {
          addKeyword(
            `${words[i]} ${words[j]}`,
            'semantic',
            'informational',
            Math.floor(Math.random() * 20) + 20,
          );
          addKeyword(
            `${words[i]} and ${words[j]}`,
            'semantic',
            'informational',
            Math.floor(Math.random() * 20) + 15,
          );
        }
      }
    }

    // 5. Question keywords
    const questionWords = [
      'what',
      'why',
      'how',
      'when',
      'where',
      'which',
      'who',
      'can',
      'does',
      'are',
      'will',
      'should',
    ];
    for (const qw of questionWords) {
      addKeyword(
        `${qw} ${qw === 'does' || qw === 'can' || qw === 'will' || qw === 'should' ? topic : `is ${topic}`}`,
        'question',
        'informational',
        Math.floor(Math.random() * 15) + 10,
      );
    }

    keywords.sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0));
    return keywords.slice(0, 50);
  }

  // -----------------------------------------------------------------------
  // UTILITY HELPERS
  // -----------------------------------------------------------------------

  /**
   * Calculate the average of a number array.
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
  }

  /**
   * Convert a string to Title Case.
   */
  private toTitleCase(str: string): string {
    return str
      .replace(/[-_]/g, ' ')
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }
}

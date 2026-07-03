import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { DeepSeekService } from '../../ai/providers/deepseek.service';
import { TrendFilterDto, TrendCategory, TrendStatus } from './dto/trend-filter.dto';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';
import * as crypto from 'crypto';

interface TrendSourceResult {
  source: string;
  trends: RawTrend[];
  error?: string;
}

interface RawTrend {
  title: string;
  description?: string;
  url?: string;
  source: string;
  category?: string;
  volume?: number;
  growthRate?: number;
  relatedTopics?: string[];
  publishedAt?: Date;
}

interface DiscoverOptions {
  sources?: string[];
  forceRefresh?: boolean;
}

@Injectable()
export class TrendDiscoveryService {
  private readonly logger = new Logger(TrendDiscoveryService.name);

  private readonly SOURCES = {
    GOOGLE_TRENDS: 'google_trends',
    GOOGLE_NEWS: 'google_news',
    BING_NEWS: 'bing_news',
    REDDIT: 'reddit',
    TWITTER: 'twitter',
    YOUTUBE: 'youtube',
    RSS: 'rss',
    PRODUCT_HUNT: 'product_hunt',
    GITHUB_TRENDING: 'github_trending',
    HACKER_NEWS: 'hacker_news',
    STACK_OVERFLOW: 'stack_overflow',
    QUORA: 'quora',
  };

  private readonly AVAILABLE_SOURCES = [
    { id: this.SOURCES.GOOGLE_TRENDS, name: 'Google Trends', enabled: true, category: 'search' },
    { id: this.SOURCES.GOOGLE_NEWS, name: 'Google News', enabled: true, category: 'news' },
    { id: this.SOURCES.BING_NEWS, name: 'Bing News', enabled: true, category: 'news' },
    { id: this.SOURCES.REDDIT, name: 'Reddit', enabled: true, category: 'social' },
    { id: this.SOURCES.TWITTER, name: 'Twitter/X', enabled: true, category: 'social' },
    { id: this.SOURCES.YOUTUBE, name: 'YouTube', enabled: true, category: 'video' },
    { id: this.SOURCES.RSS, name: 'RSS Aggregator', enabled: true, category: 'aggregator' },
    { id: this.SOURCES.PRODUCT_HUNT, name: 'Product Hunt', enabled: true, category: 'products' },
    { id: this.SOURCES.GITHUB_TRENDING, name: 'GitHub Trending', enabled: true, category: 'development' },
    { id: this.SOURCES.HACKER_NEWS, name: 'Hacker News', enabled: true, category: 'technology' },
    { id: this.SOURCES.STACK_OVERFLOW, name: 'Stack Overflow', enabled: true, category: 'development' },
    { id: this.SOURCES.QUORA, name: 'Quora', enabled: true, category: 'qa' },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly deepseek: DeepSeekService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectQueue('trends') private trendsQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async discoverTrends(): Promise<void> {
    this.logger.log('Starting scheduled trend discovery from all sources...');
    const job = await this.trendsQueue.add('discover', {
      timestamp: new Date().toISOString(),
    });
    try {
      const allResults = await this.fetchAllSources();
      const deduplicated = this.deduplicateTrends(allResults);
      const analyzed = await this.batchAnalyzeWithDeepSeek(deduplicated);
      const saved = await this.saveTrends(analyzed);
      this.logger.log(`Scheduled trend discovery complete. Saved ${saved.length} trends.`);
    } catch (error) {
      this.logger.error(`Scheduled trend discovery failed: ${error.message}`, error.stack);
    }
  }

  async manualDiscover(options?: DiscoverOptions): Promise<{ message: string; jobId: string }> {
    const job = await this.trendsQueue.add('manual-discover', {
      ...options,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`Manual trend discovery triggered with job ID: ${job.id}`);
    return {
      message: 'Trend discovery started. This may take a few minutes.',
      jobId: job.id.toString(),
    };
  }

  private async fetchAllSources(): Promise<TrendSourceResult[]> {
    const sourcePromises = Object.entries(this.SOURCES).map(async ([key, source]) => {
      return this.fetchWithTimeout(source, this.fetchSource(source));
    });

    const results = await Promise.allSettled(sourcePromises);
    const fulfilled: TrendSourceResult[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        fulfilled.push(result.value);
      } else {
        this.logger.warn(`Source fetch failed: ${result.reason?.message || result.reason}`);
      }
    }

    return fulfilled;
  }

  private async fetchWithTimeout(
    source: string,
    promise: Promise<TrendSourceResult>,
    timeoutMs: number = 30000,
  ): Promise<TrendSourceResult> {
    const timeoutPromise = new Promise<TrendSourceResult>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout fetching ${source} after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]);
  }

  private async fetchSource(source: string): Promise<TrendSourceResult> {
    switch (source) {
      case this.SOURCES.GOOGLE_TRENDS:
        return this.fetchGoogleTrends();
      case this.SOURCES.GOOGLE_NEWS:
        return this.fetchGoogleNews();
      case this.SOURCES.BING_NEWS:
        return this.fetchBingNews();
      case this.SOURCES.REDDIT:
        return this.fetchReddit();
      case this.SOURCES.TWITTER:
        return this.fetchTwitter();
      case this.SOURCES.YOUTUBE:
        return this.fetchYouTube();
      case this.SOURCES.RSS:
        return this.fetchRSS();
      case this.SOURCES.PRODUCT_HUNT:
        return this.fetchProductHunt();
      case this.SOURCES.GITHUB_TRENDING:
        return this.fetchGitHubTrending();
      case this.SOURCES.HACKER_NEWS:
        return this.fetchHackerNews();
      case this.SOURCES.STACK_OVERFLOW:
        return this.fetchStackOverflow();
      case this.SOURCES.QUORA:
        return this.fetchQuora();
      default:
        return { source, trends: [] };
    }
  }

  private async fetchGoogleTrends(): Promise<TrendSourceResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.get('https://trends.google.com/trending/rss?geo=US', {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AutoblogAI/1.0)' },
        }),
      );
      const $ = cheerio.load(response.data, { xmlMode: true });
      const trends: RawTrend[] = [];
      $('item').each((i, el) => {
        if (i >= 30) return false;
        trends.push({
          title: $(el).find('title').text().trim(),
          description: $(el).find('description').text().trim(),
          source: this.SOURCES.GOOGLE_TRENDS,
          category: this.inferCategory($(el).find('title').text().trim()),
          volume: parseInt($(el).find('ht\\:approx_traffic').text() || '0', 10) || undefined,
          publishedAt: new Date(),
        });
      });
      return { source: this.SOURCES.GOOGLE_TRENDS, trends };
    } catch (error) {
      this.logger.warn(`Google Trends fetch failed (may need pytrends): ${error.message}`);
      return {
        source: this.SOURCES.GOOGLE_TRENDS,
        trends: [],
        error: error.message,
      };
    }
  }

  private async fetchGoogleNews(): Promise<TrendSourceResult> {
    try {
      const topics = ['technology', 'science', 'health', 'business', 'entertainment', 'world'];
      const allTrends: RawTrend[] = [];
      for (const topic of topics) {
        try {
          const response = await firstValueFrom(
            this.httpService.get(
              `https://news.google.com/rss/topics/${topic}?hl=en-US&gl=US&ceid=US:en`,
              { headers: { 'User-Agent': 'Mozilla/5.0' } },
            ),
          );
          const $ = cheerio.load(response.data, { xmlMode: true });
          $('item').each((i, el) => {
            if (i >= 10) return false;
            const title = $(el).find('title').text().trim();
            if (title && !allTrends.some((t) => t.title === title)) {
              allTrends.push({
                title,
                description: $(el).find('description').text().trim(),
                url: $(el).find('link').text().trim(),
                source: this.SOURCES.GOOGLE_NEWS,
                category: topic,
                publishedAt: new Date($(el).find('pubDate').text() || new Date()),
              });
            }
          });
        } catch { /* continue to next topic */ }
      }
      return { source: this.SOURCES.GOOGLE_NEWS, trends: allTrends };
    } catch (error) {
      return { source: this.SOURCES.GOOGLE_NEWS, trends: [], error: error.message };
    }
  }

  private async fetchBingNews(): Promise<TrendSourceResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.get('https://www.bing.com/news/search?q=trending&format=rss', {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        }),
      );
      const $ = cheerio.load(response.data, { xmlMode: true });
      const trends: RawTrend[] = [];
      $('item').each((i, el) => {
        if (i >= 30) return false;
        trends.push({
          title: $(el).find('title').text().trim(),
          description: $(el).find('description').text().trim(),
          url: $(el).find('link').text().trim(),
          source: this.SOURCES.BING_NEWS,
          category: this.inferCategory($(el).find('title').text().trim()),
          publishedAt: new Date($(el).find('pubDate').text() || new Date()),
        });
      });
      return { source: this.SOURCES.BING_NEWS, trends };
    } catch (error) {
      return { source: this.SOURCES.BING_NEWS, trends: [], error: error.message };
    }
  }

  private async fetchReddit(): Promise<TrendSourceResult> {
    try {
      const subreddits = ['technology', 'science', 'programming', 'artificial', 'MachineLearning', 'dataisbeautiful', 'startups', 'business', 'Futurology'];
      const allTrends: RawTrend[] = [];
      for (const sub of subreddits) {
        try {
          const response = await firstValueFrom(
            this.httpService.get(`https://www.reddit.com/r/${sub}/hot.json?limit=10`, {
              headers: {
                'User-Agent': 'AutoblogAI/1.0 (Trend Discovery Bot)',
              },
            }),
          );
          if (response.data?.data?.children) {
            for (const child of response.data.data.children) {
              const data = child.data;
              if (data && !allTrends.some((t) => t.title === data.title)) {
                allTrends.push({
                  title: data.title,
                  description: data.selftext?.substring(0, 300),
                  url: `https://reddit.com${data.permalink}`,
                  source: this.SOURCES.REDDIT,
                  category: sub,
                  volume: data.ups || 0,
                  growthRate: data.num_comments || 0,
                  relatedTopics: [sub],
                  publishedAt: new Date(data.created_utc * 1000),
                });
              }
            }
          }
        } catch { /* continue */ }
      }
      return { source: this.SOURCES.REDDIT, trends: allTrends };
    } catch (error) {
      return { source: this.SOURCES.REDDIT, trends: [], error: error.message };
    }
  }

  private async fetchTwitter(): Promise<TrendSourceResult> {
    try {
      const bearerToken = process.env.TWITTER_BEARER_TOKEN;
      if (!bearerToken) {
        this.logger.warn('Twitter bearer token not configured, skipping');
        return { source: this.SOURCES.TWITTER, trends: [] };
      }
      const response = await firstValueFrom(
        this.httpService.get('https://api.twitter.com/2/trends/by/woeid/23424977', {
          headers: { Authorization: `Bearer ${bearerToken}` },
        }),
      );
      const trends: RawTrend[] = (response.data?.[0]?.trends || []).slice(0, 30).map((t: any) => ({
        title: t.name,
        description: `Tweet volume: ${t.tweet_volume || 'N/A'}`,
        source: this.SOURCES.TWITTER,
        category: this.inferCategory(t.name),
        volume: t.tweet_volume || undefined,
        growthRate: undefined,
        publishedAt: new Date(),
      }));
      return { source: this.SOURCES.TWITTER, trends };
    } catch (error) {
      this.logger.warn(`Twitter API fetch failed: ${error.message}`);
      return { source: this.SOURCES.TWITTER, trends: [], error: error.message };
    }
  }

  private async fetchYouTube(): Promise<TrendSourceResult> {
    try {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        return { source: this.SOURCES.YOUTUBE, trends: [] };
      }
      const regionCodes = ['US', 'GB', 'IN', 'CA', 'AU'];
      const allTrends: RawTrend[] = [];
      for (const region of regionCodes) {
        try {
          const response = await firstValueFrom(
            this.httpService.get('https://www.googleapis.com/youtube/v3/videos', {
              params: {
                part: 'snippet,statistics',
                chart: 'mostPopular',
                regionCode: region,
                maxResults: 10,
                key: apiKey,
              },
            }),
          );
          for (const item of response.data?.items || []) {
            const title = item.snippet?.title;
            if (title && !allTrends.find((t) => t.title === title)) {
              allTrends.push({
                title,
                description: item.snippet?.description?.substring(0, 200),
                url: `https://youtube.com/watch?v=${item.id}`,
                source: this.SOURCES.YOUTUBE,
                category: this.inferCategory(item.snippet?.tags?.[0] || item.snippet?.categoryId),
                volume: parseInt(item.statistics?.viewCount || '0', 10),
                growthRate: parseInt(item.statistics?.likeCount || '0', 10),
                publishedAt: new Date(item.snippet?.publishedAt),
              });
            }
          }
        } catch { /* continue */ }
      }
      return { source: this.SOURCES.YOUTUBE, trends: allTrends };
    } catch (error) {
      return { source: this.SOURCES.YOUTUBE, trends: [], error: error.message };
    }
  }

  private async fetchRSS(): Promise<TrendSourceResult> {
    const rssFeeds = [
      'https://feeds.feedburner.com/TechCrunch/',
      'https://www.wired.com/feed/rss',
      'https://www.theverge.com/rss/index.xml',
      'https://arstechnica.com/feed/',
      'https://www.zdnet.com/news/rss.xml',
      'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',
      'https://feeds.bbci.co.uk/news/technology/rss.xml',
      'https://www.sciencealert.com/feed',
    ];
    const allTrends: RawTrend[] = [];
    for (const feedUrl of rssFeeds) {
      try {
        const response = await firstValueFrom(
          this.httpService.get(feedUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000,
          }),
        );
        const $ = cheerio.load(response.data, { xmlMode: true });
        $('item, entry').each((i, el) => {
          if (i >= 5) return false;
          const title = $(el).find('title').text().trim();
          if (title && !allTrends.some((t) => t.title === title)) {
            allTrends.push({
              title,
              description: $(el).find('description').text().trim().substring(0, 300) || $(el).find('summary').text().trim().substring(0, 300),
              url: $(el).find('link').last().text().trim() || $(el).find('link').attr('href'),
              source: this.SOURCES.RSS,
              category: this.inferCategory(title),
              publishedAt: new Date($(el).find('pubDate').text() || $(el).find('updated').text() || new Date()),
            });
          }
        });
      } catch { /* continue */ }
    }
    return { source: this.SOURCES.RSS, trends: allTrends };
  }

  private async fetchProductHunt(): Promise<TrendSourceResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.get('https://api.producthunt.com/v2/api/graphql', {
          headers: {
            Authorization: `Bearer ${process.env.PRODUCTHUNT_TOKEN || ''}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          data: {
            query: `{ posts(first: 20, order: VOTES) { edges { node { name tagline description url votesCount createdAt } } } }`,
          },
          method: 'POST',
        }),
      );
      const posts = response.data?.data?.posts?.edges || [];
      const trends: RawTrend[] = posts.map((edge: any) => ({
        title: edge.node.name,
        description: edge.node.tagline || edge.node.description?.substring(0, 300),
        url: edge.node.url,
        source: this.SOURCES.PRODUCT_HUNT,
        category: 'technology',
        volume: edge.node.votesCount || 0,
        publishedAt: new Date(edge.node.createdAt),
      }));
      return { source: this.SOURCES.PRODUCT_HUNT, trends };
    } catch (error) {
      if (!process.env.PRODUCTHUNT_TOKEN) {
        this.logger.warn('Product Hunt token not configured, scraping public page');
        return this.scrapeProductHunt();
      }
      return { source: this.SOURCES.PRODUCT_HUNT, trends: [], error: error.message };
    }
  }

  private async scrapeProductHunt(): Promise<TrendSourceResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.get('https://www.producthunt.com/', {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        }),
      );
      const $ = cheerio.load(response.data);
      const trends: RawTrend[] = [];
      $('[data-test="post-item"]').each((i, el) => {
        if (i >= 15) return false;
        trends.push({
          title: $(el).find('a[data-test="post-name"]').text().trim(),
          description: $(el).find('[data-test="post-tagline"]').text().trim(),
          url: `https://www.producthunt.com${$(el).find('a[data-test="post-name"]').attr('href') || ''}`,
          source: this.SOURCES.PRODUCT_HUNT,
          category: 'technology',
          volume: parseInt($(el).find('[data-test="vote-button"]').text().trim(), 10) || undefined,
          publishedAt: new Date(),
        });
      });
      return { source: this.SOURCES.PRODUCT_HUNT, trends };
    } catch (error) {
      return { source: this.SOURCES.PRODUCT_HUNT, trends: [], error: error.message };
    }
  }

  private async fetchGitHubTrending(): Promise<TrendSourceResult> {
    try {
      const languages = ['', 'javascript', 'python', 'typescript', 'rust', 'go', 'java'];
      const allTrends: RawTrend[] = [];
      for (const lang of languages) {
        try {
          const url = lang
            ? `https://github.com/trending/${lang}?since=weekly`
            : 'https://github.com/trending?since=weekly';
          const response = await firstValueFrom(
            this.httpService.get(url, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
            }),
          );
          const $ = cheerio.load(response.data);
          $('article.Box-row').each((i, el) => {
            if (i >= 5) return false;
            const repoName = $(el).find('h2 a').text().trim().replace(/\s+/g, '');
            const description = $(el).find('p').text().trim();
            const stars = $(el).find('.octicon-star').parent().text().trim();
            if (repoName && !allTrends.find((t) => t.title === repoName)) {
              allTrends.push({
                title: repoName,
                description: description.substring(0, 300),
                url: `https://github.com/${repoName}`,
                source: this.SOURCES.GITHUB_TRENDING,
                category: 'development',
                volume: parseInt(stars.replace(/,/g, ''), 10) || undefined,
                relatedTopics: lang ? [lang] : [],
                publishedAt: new Date(),
              });
            }
          });
        } catch { /* continue */ }
      }
      return { source: this.SOURCES.GITHUB_TRENDING, trends: allTrends };
    } catch (error) {
      return { source: this.SOURCES.GITHUB_TRENDING, trends: [], error: error.message };
    }
  }

  private async fetchHackerNews(): Promise<TrendSourceResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.get('https://hacker-news.firebaseio.com/v0/topstories.json'),
      );
      const storyIds: number[] = (response.data || []).slice(0, 30);
      const allTrends: RawTrend[] = [];
      const batchSize = 10;
      for (let i = 0; i < storyIds.length; i += batchSize) {
        const batch = storyIds.slice(i, i + batchSize);
        const stories = await Promise.allSettled(
          batch.map((id) =>
            firstValueFrom(
              this.httpService.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`),
            ).then((r) => r.data),
          ),
        );
        for (const result of stories) {
          if (result.status === 'fulfilled' && result.value && !result.value.deleted) {
            const story = result.value;
            if (story.title && !allTrends.find((t) => t.title === story.title)) {
              allTrends.push({
                title: story.title,
                description: story.text?.substring(0, 300) || `Points: ${story.score || 0}, Comments: ${story.descendants || 0}`,
                url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
                source: this.SOURCES.HACKER_NEWS,
                category: this.inferCategory(story.title),
                volume: story.score || 0,
                growthRate: story.descendants || 0,
                publishedAt: new Date((story.time || 0) * 1000),
              });
            }
          }
        }
      }
      return { source: this.SOURCES.HACKER_NEWS, trends: allTrends };
    } catch (error) {
      return { source: this.SOURCES.HACKER_NEWS, trends: [], error: error.message };
    }
  }

  private async fetchStackOverflow(): Promise<TrendSourceResult> {
    try {
      const tags = ['javascript', 'python', 'react', 'node.js', 'typescript', 'rust', 'kubernetes', 'docker', 'machine-learning', 'artificial-intelligence'];
      const allTrends: RawTrend[] = [];
      for (const tag of tags) {
        try {
          const response = await firstValueFrom(
            this.httpService.get('https://api.stackexchange.com/2.3/questions', {
              params: {
                order: 'desc',
                sort: 'hot',
                tagged: tag,
                site: 'stackoverflow',
                pagesize: 5,
                filter: 'withbody',
              },
            }),
          );
          for (const item of response.data?.items || []) {
            const title = item.title;
            if (title && !allTrends.find((t) => t.title === title)) {
              allTrends.push({
                title,
                description: item.body?.substring(0, 300)?.replace(/<[^>]*>/g, '') || '',
                url: item.link,
                source: this.SOURCES.STACK_OVERFLOW,
                category: 'development',
                volume: item.view_count || 0,
                growthRate: item.score || 0,
                relatedTopics: item.tags || [tag],
                publishedAt: new Date(item.creation_date * 1000),
              });
            }
          }
        } catch { /* continue */ }
      }
      return { source: this.SOURCES.STACK_OVERFLOW, trends: allTrends };
    } catch (error) {
      return { source: this.SOURCES.STACK_OVERFLOW, trends: [], error: error.message };
    }
  }

  private async fetchQuora(): Promise<TrendSourceResult> {
    try {
      const topics = ['Technology', 'Science', 'Artificial-Intelligence', 'Programming', 'Machine-Learning', 'Startups', 'Digital-Marketing', 'SEO'];
      const allTrends: RawTrend[] = [];
      for (const topic of topics) {
        try {
          const response = await firstValueFrom(
            this.httpService.get(`https://www.quora.com/topic/${topic}`, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
            }),
          );
          const $ = cheerio.load(response.data);
          $('.q-text.qu-bold').each((i, el) => {
            if (i >= 5) return false;
            const title = $(el).text().trim();
            if (title && title.length > 10 && !allTrends.find((t) => t.title === title)) {
              allTrends.push({
                title,
                source: this.SOURCES.QUORA,
                category: topic.toLowerCase(),
                publishedAt: new Date(),
              });
            }
          });
        } catch { /* continue */ }
      }
      return { source: this.SOURCES.QUORA, trends: allTrends };
    } catch (error) {
      return { source: this.SOURCES.QUORA, trends: [], error: error.message };
    }
  }

  private deduplicateTrends(sourceResults: TrendSourceResult[]): RawTrend[] {
    const seen = new Map<string, RawTrend>();
    const normalizedTitle = (title: string): string =>
      title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    for (const result of sourceResults) {
      for (const trend of result.trends) {
        const key = normalizedTitle(trend.title);
        if (!key) continue;

        if (seen.has(key)) {
          const existing = seen.get(key)!;
          existing.volume = Math.max(existing.volume || 0, trend.volume || 0);
          existing.growthRate = Math.max(existing.growthRate || 0, trend.growthRate || 0);
          if (trend.description && !existing.description) {
            existing.description = trend.description;
          }
          if (!existing.relatedTopics) existing.relatedTopics = [];
          if (trend.relatedTopics) {
            for (const topic of trend.relatedTopics) {
              if (!existing.relatedTopics.includes(topic)) {
                existing.relatedTopics.push(topic);
              }
            }
          }
        } else {
          seen.set(key, { ...trend });
        }
      }
    }

    return Array.from(seen.values());
  }

  private async batchAnalyzeWithDeepSeek(trends: RawTrend[]): Promise<any[]> {
    const batchSize = 20;
    const results: any[] = [];

    for (let i = 0; i < trends.length; i += batchSize) {
      const batch = trends.slice(i, i + batchSize);
      try {
        const prompt = this.buildTrendAnalysisPrompt(batch);
        const analysis = await this.deepseek.complete({
          model: 'deepseek-reasoner',
          messages: [{ role: 'system', content: this.getTrendAnalysisSystemPrompt() }, { role: 'user', content: prompt }],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        });

        const parsed = JSON.parse(analysis.choices[0].message.content);
        const analyzedTrends = parsed.trends || parsed.results || [];

        for (let j = 0; j < batch.length; j++) {
          const trend = batch[j];
          const analysisData = analyzedTrends[j] || {};
          results.push({
            ...trend,
            score: analysisData.score || this.calculateFallbackScore(trend),
            category: analysisData.category || trend.category || 'general',
            seasonality: analysisData.seasonality || 'stable',
            competitionLevel: analysisData.competitionLevel || 'medium',
            suggestedTopics: analysisData.suggestedTopics || [],
            keywords: analysisData.keywords || [trend.title],
            analysis: analysisData.analysis || '',
            opportunityScore: analysisData.opportunityScore || 50,
            lifecycleStage: analysisData.lifecycleStage || 'growth',
          });
        }
      } catch (error) {
        this.logger.error(`DeepSeek batch analysis failed for batch ${i}: ${error.message}`);
        for (const trend of batch) {
          results.push({
            ...trend,
            score: this.calculateFallbackScore(trend),
            category: trend.category || 'general',
            seasonality: this.mapSeasonality('stable'),
            competitionLevel: 'medium',
            suggestedTopics: [],
            keywords: [trend.title],
            analysis: '',
            opportunityScore: 50,
            lifecycleStage: 'growth',
          });
        }
      }
    }

    return results;
  }

  private buildTrendAnalysisPrompt(trends: RawTrend[]): string {
    const trendsJson = trends.map((t, i) => ({
      id: i,
      title: t.title,
      source: t.source,
      volume: t.volume || null,
      growthRate: t.growthRate || null,
      description: t.description || '',
    }));

    return JSON.stringify({
      task: 'Analyze the following trending topics and provide scores and categorization for each.',
      trends: trendsJson,
      instructions: `For each trend, provide:
1. score: A number from 0-100 indicating overall trend strength/potential
2. category: The most appropriate category from: technology, business, health, science, entertainment, sports, politics, education, lifestyle, finance, ai, seo, marketing, other
3. seasonality: One of: peak, stable, declining, seasonal
4. competitionLevel: One of: low, medium, high, very_high
5. opportunityScore: A number 0-100 representing the content opportunity gap
6. lifecycleStage: One of: emerging, growth, maturity, decline
7. suggestedTopics: Array of 3-5 related subtopics or content angles
8. keywords: Array of 3-7 relevant keywords for content creation
9. analysis: A 2-3 sentence analysis of why this trend matters`,
      output_format: {
        trends: 'Array of analyzed trend objects with all fields above',
      },
    });
  }

  private getTrendAnalysisSystemPrompt(): string {
    return `You are a trend analysis expert for content marketing. Your role is to analyze trending topics and provide actionable insights for content creators.

For each trend, evaluate:
- Search volume potential (based on provided volume data and your knowledge)
- Competition level (how saturated is this topic?)
- Seasonality (is this a recurring trend or evergreen?)
- Opportunity score (how much opportunity exists for new content?)
- Lifecycle stage (is this emerging, growing, mature, or declining?)

Output ONLY valid JSON matching the requested format. Be precise with your scoring.`;
  }

  private calculateFallbackScore(trend: RawTrend): number {
    let score = 50;
    if (trend.volume) {
      if (trend.volume > 100000) score += 30;
      else if (trend.volume > 10000) score += 20;
      else if (trend.volume > 1000) score += 10;
    }
    if (trend.growthRate) {
      if (trend.growthRate > 1000) score += 15;
      else if (trend.growthRate > 100) score += 10;
      else if (trend.growthRate > 10) score += 5;
    }
    if (trend.source === this.SOURCES.HACKER_NEWS || trend.source === this.SOURCES.REDDIT) {
      score += 5;
    }
    return Math.min(Math.max(score, 0), 100);
  }

  private mapSeasonality(seasonality: string): number {
    switch (seasonality?.toLowerCase()) {
      case 'peak':
        return 100;
      case 'stable':
        return 50;
      case 'declining':
        return 20;
      case 'seasonal':
        return 75;
      default:
        return 50;
    }
  }

  private async saveTrends(analyzedTrends: any[]): Promise<any[]> {
    const saved: any[] = [];
    for (const trend of analyzedTrends) {
      try {
        const normalizedTitle = trend.title?.trim();
        if (!normalizedTitle) continue;

        const existing = await this.prisma.trend.findFirst({
          where: { title: normalizedTitle },
        });

        const trendData = {
          title: normalizedTitle,
          description: trend.description || '',
          url: trend.url || '',
          source: trend.source || 'unknown',
          category: trend.category || 'general',
          score: Math.min(Math.max(trend.score || 50, 0), 100),
          volume: trend.volume || 0,
          growthRate: trend.growthRate || 0,
          seasonality: trend.seasonality || 'stable',
          competitionLevel: trend.competitionLevel || 'medium',
          opportunityScore: Math.min(Math.max(trend.opportunityScore || 50, 0), 100),
          lifecycleStage: trend.lifecycleStage || 'growth',
          suggestedTopics: trend.suggestedTopics || [],
          keywords: trend.keywords || [],
          analysis: trend.analysis || '',
          relatedTopics: trend.relatedTopics || [],
          publishedAt: trend.publishedAt || new Date(),
          lastSeenAt: new Date(),
          status: this.determineStatus(trend),
        };

        let savedTrend: any;
        if (existing) {
          savedTrend = await this.prisma.trend.update({
            where: { id: existing.id },
            data: {
              ...trendData,
              score: Math.max(existing.score, trendData.score),
              volume: Math.max(existing.volume, trendData.volume),
              lastSeenAt: new Date(),
              seenCount: { increment: 1 },
            },
          });
        } else {
          savedTrend = await this.prisma.trend.create({
            data: {
              ...trendData,
              seenCount: 1,
            },
          });
        }
        saved.push(savedTrend);
      } catch (error) {
        this.logger.error(`Failed to save trend "${trend.title}": ${error.message}`);
      }
    }
    return saved;
  }

  private determineStatus(trend: any): string {
    if (trend.score >= 70) return 'active';
    if (trend.score >= 40) return 'stable';
    if (trend.seasonality === 'declining') return 'declining';
    return 'stable';
  }

  private inferCategory(title: string): string {
    const lower = title.toLowerCase();
    if (/\b(ai|artificial intelligence|machine learning|deep learning|llm|gpt|neural)\b/.test(lower)) return 'ai';
    if (/\b(tech|software|app|digital|cyber|data|cloud|blockchain|crypto|programming)\b/.test(lower)) return 'technology';
    if (/\b(health|medical|disease|treatment|doctor|hospital|wellness|fitness|nutrition|mental)\b/.test(lower)) return 'health';
    if (/\b(science|research|study|discovery|space|biology|physics|chemistry)\b/.test(lower)) return 'science';
    if (/\b(business|startup|entrepreneur|market|economy|invest|finance|stock|crypto|funding)\b/.test(lower)) return 'business';
    if (/\b(seo|content|marketing|social media|blog|traffic|rank|search)\b/.test(lower)) return 'marketing';
    if (/\b(education|learn|course|student|teacher|school|university|training)\b/.test(lower)) return 'education';
    if (/\b(entertain|movie|music|game|gaming|celebrity|tv|stream|video)\b/.test(lower)) return 'entertainment';
    if (/\b(sport|nba|nfl|soccer|football|baseball|basketball|olymp|champion)\b/.test(lower)) return 'sports';
    if (/\b(politic|government|election|president|senate|congress|policy|law|regulation)\b/.test(lower)) return 'politics';
    if (/\b(finance|money|invest|saving|retire|tax|bank|loan|credit|debt)\b/.test(lower)) return 'finance';
    return 'other';
  }

  // Public API methods
  async findAll(filter: TrendFilterDto): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const where: any = {};

    if (filter.search) {
      where.OR = [
        { title: { contains: filter.search, mode: 'insensitive' } },
        { description: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    if (filter.category) where.category = filter.category;
    if (filter.status) where.status = filter.status;
    if (filter.source) where.source = filter.source;
    if (filter.minScore !== undefined || filter.maxScore !== undefined) {
      where.score = {};
      if (filter.minScore !== undefined) where.score.gte = filter.minScore;
      if (filter.maxScore !== undefined) where.score.lte = filter.maxScore;
    }
    if (filter.minVolume !== undefined) where.volume = { gte: filter.minVolume };
    if (filter.startDate) where.publishedAt = { ...(where.publishedAt || {}), gte: new Date(filter.startDate) };
    if (filter.endDate) where.publishedAt = { ...(where.publishedAt || {}), lte: new Date(filter.endDate) };

    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const orderBy: any = {};
    const sortField = filter.sortBy || 'score';
    orderBy[sortField] = filter.sortOrder?.toLowerCase() === 'asc' ? 'asc' : 'desc';

    const [data, total] = await Promise.all([
      this.prisma.trend.findMany({ where, orderBy, skip, take: limit }),
      this.prisma.trend.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findById(id: string): Promise<any> {
    const trend = await this.prisma.trend.findUnique({ where: { id } });
    if (!trend) throw new NotFoundException(`Trend with ID ${id} not found`);
    return trend;
  }

  async findOpportunities(options: { minScore?: number; category?: TrendCategory; limit?: number }): Promise<any[]> {
    const where: any = {
      score: { gte: options.minScore || 60 },
      opportunityScore: { gte: 50 },
      status: 'active',
    };
    if (options.category) where.category = options.category;

    return this.prisma.trend.findMany({
      where,
      orderBy: { opportunityScore: 'desc' },
      take: options.limit || 20,
    });
  }

  async getSources(): Promise<any[]> {
    return this.AVAILABLE_SOURCES;
  }

  async getStats(days: number = 30): Promise<any> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [totalTrends, activeTrends, categoryCounts, sourceCounts, topTrends] = await Promise.all([
      this.prisma.trend.count(),
      this.prisma.trend.count({ where: { status: 'active' } }),
      this.prisma.trend.groupBy({ by: ['category'], _count: true, where: { lastSeenAt: { gte: since } } }),
      this.prisma.trend.groupBy({ by: ['source'], _count: true, where: { lastSeenAt: { gte: since } } }),
      this.prisma.trend.findMany({ where: { status: 'active' }, orderBy: { score: 'desc' }, take: 10 }),
    ]);

    return {
      totalTrends,
      activeTrends,
      newTrendsLast30Days: categoryCounts.reduce((sum, c) => sum + c._count, 0),
      categories: categoryCounts,
      sources: sourceCounts,
      topTrends,
      generatedAt: new Date(),
    };
  }

  async findRelated(id: string): Promise<any[]> {
    const trend = await this.findById(id);
    if (!trend.relatedTopics?.length && !trend.keywords?.length) {
      return this.prisma.trend.findMany({
        where: {
          id: { not: id },
          category: trend.category,
          status: 'active',
        },
        orderBy: { score: 'desc' },
        take: 10,
      });
    }

    const searchTerms = [...(trend.relatedTopics || []), ...(trend.keywords || [])].filter(Boolean);
    return this.prisma.trend.findMany({
      where: {
        id: { not: id },
        status: 'active',
        OR: [
          { category: trend.category },
          { relatedTopics: { hasSome: searchTerms } },
          { keywords: { hasSome: searchTerms } },
        ],
      },
      orderBy: { score: 'desc' },
      take: 10,
    });
  }
}

import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError, AxiosRequestConfig } from 'axios';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';

import { PrismaService } from '../../database/prisma.service';
import { DeepSeekService } from '../ai/providers/deepseek.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompetitorAnalysisOptions {
  depth?: 'quick' | 'standard' | 'deep' | 'comprehensive';
  includeBacklinks?: boolean;
  includeLighthouse?: boolean;
  includeSchema?: boolean;
  includeFAQ?: boolean;
  maxCompetitors?: number;
  country?: string;
  language?: string;
}

export interface HeadingData {
  level: number;
  text: string;
  tag: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface ScrapedPage {
  url: string;
  title: string;
  metaDescription: string;
  headings: HeadingData[];
  wordCount: number;
  readabilityScore: number;
  readabilityGrade: number;
  internalLinks: string[];
  externalLinks: string[];
  images: Array<{ src: string; alt: string }>;
  schemaTypes: string[];
  faqData: FaqItem[] | null;
  textContent: string;
  canonicalUrl: string | null;
  ogImage: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  favicon: string | null;
  language: string | null;
  hasMetaRobots: boolean;
  metaRobots: string | null;
  lastModified: string | null;
  contentType: string | null;
  responseTimeMs: number;
}

export interface CompetitorAnalysisResult {
  id: string;
  keyword: string;
  competitors: ScrapedPage[];
  summary: DeepSeekAnalysis | null;
  opportunities: string[];
  contentGaps: ContentGap[];
  analyzedAt: Date;
}

export interface ContentGap {
  topic: string;
  priority: 'high' | 'medium' | 'low';
  mentionedIn: string[];
  missingFrom: string[];
  searchVolume_: number | null;
  difficulty_: number | null;
}

export interface DeepSeekAnalysis {
  competitiveLandscape: string;
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
  contentGaps: ContentGap[];
  recommendedStrategy: string;
  keywordOpportunities: Array<{
    keyword: string;
    rationale: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  seoTactics: string[];
  topicalAuthority: {
    covered: string[];
    missing: string[];
    recommendations: string[];
  };
  marketPositioning: {
    pricePoints: string[];
    uniqueSellingPoints: string[];
    targetAudiences: string[];
  };
}

// ---------------------------------------------------------------------------
// Readability helpers (Flesch-Kincaid)
// ---------------------------------------------------------------------------

const SYLLABLE_EXCEPTIONS: Record<string, number> = {
  ate: 1, are: 1, acre: 2, bride: 1, cafe: 2, cede: 1, cite: 1, cute: 1,
  ere: 1, eve: 1, eye: 1, fare: 1, file: 1, fire: 1, fore: 1, fuse: 1,
  gave: 1, gone: 1, here: 1, hire: 1, hole: 1, home: 1, ice: 1, ire: 1,
  late: 1, lone: 1, lore: 1, made: 1, make: 1, mane: 1, mile: 1, mine: 1,
  more: 1, name: 1, node: 1, note: 1, one: 1, ore: 1, pane: 1, pare: 1,
  pole: 1, pore: 1, pure: 1, rage: 1, rare: 1, rate: 1, robe: 1, rode: 1,
  role: 1, rope: 1, rose: 1, rote: 1, rude: 1, rule: 1, safe: 1, sage: 1,
  sake: 1, sale: 1, same: 1, sane: 1, sake: 1, seal: 1, sect: 1, side: 1,
  site: 1, size: 1, sole: 1, some: 1, sore: 1, stole: 1, sure: 1, tale: 1,
  tame: 1, tape: 1, tide: 1, tile: 1, time: 1, tire: 1, tole: 1, tone: 1,
  tore: 1, tube: 1, tune: 1, vale: 1, vile: 1, vine: 1, vote: 1, ware: 1,
  were: 1, wife: 1, wire: 1, wise: 1, woke: 1, wore: 1, wove: 1, yoke: 1,
  ze: 1,
};

const VOWELS = /[aeiouy]/i;

function countSyllablesInWord(word: string): number {
  if (!word) return 0;
  const clean = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
  if (!clean) return 0;
  if (clean.length <= 2) return 1;

  const exception = SYLLABLE_EXCEPTIONS[clean];
  if (exception !== undefined) return exception;

  let count = 0;
  let prevVowel = false;
  for (let i = 0; i < clean.length; i++) {
    const isVowel = VOWELS.test(clean[i]);
    if (isVowel && !prevVowel) count++;
    prevVowel = isVowel;
  }

  if (clean.endsWith('e')) {
    count--;
    if (count < 1) count = 1;
  }
  if (clean.endsWith('le') && clean.length > 2 && !/[aeiouy]/.test(clean[clean.length - 3])) {
    count++;
  }
  if (clean.endsWith('ism') && clean.length > 4) {
    count = Math.max(1, count - 1);
  }
  if (count < 1) count = 1;
  return count;
}

function computeFleschKincaid(text: string): {
  gradeLevel: number;
  readingEase: number;
  totalWords: number;
  totalSentences: number;
  totalSyllables: number;
} {
  if (!text || text.trim().length === 0) {
    return { gradeLevel: 0, readingEase: 100, totalWords: 0, totalSentences: 0, totalSyllables: 0 };
  }

  const clean = text.replace(/[\r\n]+/g, ' ').trim();
  const sentences = clean.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const totalSentences = sentences.length || 1;
  const words = clean.split(/[\s,;:()"'-–—]+/).filter((w) => w.length > 0);
  const totalWords = words.length || 1;

  let totalSyllables = 0;
  for (const word of words) {
    totalSyllables += countSyllablesInWord(word);
  }

  const gradeLevel = 0.39 * (totalWords / totalSentences) + 11.8 * (totalSyllables / totalWords) - 15.59;
  const readingEase = 206.835 - 1.015 * (totalWords / totalSentences) - 84.6 * (totalSyllables / totalWords);

  return {
    gradeLevel: Math.max(0, Math.round(gradeLevel * 10) / 10),
    readingEase: Math.max(0, Math.min(100, Math.round(readingEase * 10) / 10)),
    totalWords,
    totalSentences,
    totalSyllables,
  };
}

// ---------------------------------------------------------------------------
// User-Agent rotation
// ---------------------------------------------------------------------------

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
];

function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class CompetitorResearchService {
  private readonly logger = new Logger(CompetitorResearchService.name);
  private readonly serpApiKey: string;
  private readonly googleApiKey: string;
  private readonly googleCx: string;
  private readonly ahrefsApiKey: string;
  private readonly requestTimeout: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deepSeekService: DeepSeekService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.serpApiKey =
      this.configService.get<string>('SERP_API_KEY') ??
      this.configService.get<string>('serp.apiKey') ??
      '';
    this.googleApiKey =
      this.configService.get<string>('GOOGLE_API_KEY') ??
      this.configService.get<string>('google.apiKey') ??
      '';
    this.googleCx =
      this.configService.get<string>('GOOGLE_CX') ??
      this.configService.get<string>('google.cx') ??
      '';
    this.ahrefsApiKey =
      this.configService.get<string>('AHREFS_API_KEY') ??
      this.configService.get<string>('ahrefs.apiKey') ??
      '';
    this.requestTimeout =
      this.configService.get<number>('competitor.requestTimeout', 15000);
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Analyze the top N competitors for a given keyword.
   *
   * Orchestration:
   *   1. Fetch SERP results (top 10 organic URLs)
   *   2. Scrape each page for on-page data
   *   3. Optionally check backlinks (Ahrefs)
   *   4. Optionally run Lighthouse performance audit
   *   5. Send aggregated data to DeepSeek for strategic analysis
   *   6. Persist results to the database
   *   7. Return the enriched result
   */
  async analyzeCompetitors(
    keyword: string,
    options?: CompetitorAnalysisOptions,
  ): Promise<CompetitorAnalysisResult> {
    const startTime = Date.now();
    this.logger.log(`Starting competitor analysis for keyword="${keyword}"`);

    const resolvedOptions: CompetitorAnalysisOptions = {
      depth: options?.depth ?? 'standard',
      includeBacklinks: options?.includeBacklinks ?? false,
      includeLighthouse: options?.includeLighthouse ?? false,
      includeSchema: options?.includeSchema ?? true,
      includeFAQ: options?.includeFAQ ?? true,
      maxCompetitors: options?.maxCompetitors ?? 5,
      country: options?.country ?? 'US',
      language: options?.language ?? 'en',
      ...options,
    };

    // 1. Fetch SERP results
    const serpUrls = await this.fetchSERPResults(
      keyword,
      resolvedOptions.country!,
      resolvedOptions.language!,
    );

    if (serpUrls.length === 0) {
      this.logger.warn(`No SERP results found for keyword="${keyword}"`);
      return {
        id: uuidv4(),
        keyword,
        competitors: [],
        summary: null,
        opportunities: [],
        contentGaps: [],
        analyzedAt: new Date(),
      };
    }

    // Limit to max competitors
    const urlsToAnalyze = serpUrls.slice(0, resolvedOptions.maxCompetitors);
    this.logger.log(`Scraping ${urlsToAnalyze.length} competitor URLs for keyword="${keyword}"`);

    // 2. Scrape each page (in parallel with concurrency control)
    const scrapedPages: ScrapedPage[] = [];
    const CONCURRENCY = 3;

    for (let i = 0; i < urlsToAnalyze.length; i += CONCURRENCY) {
      const batch = urlsToAnalyze.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((url) => this.analyzeSingleCompetitor(url, keyword)),
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          scrapedPages.push(result.value);
        } else {
          this.logger.warn(
            `Failed to analyze a competitor: ${
              result.status === 'rejected' ? result.reason?.message ?? 'Unknown error' : 'No data'
            }`,
          );
        }
      }
    }

    if (scrapedPages.length === 0) {
      this.logger.warn(`No competitors could be scraped for keyword="${keyword}"`);
      return {
        id: uuidv4(),
        keyword,
        competitors: [],
        summary: null,
        opportunities: [],
        contentGaps: [],
        analyzedAt: new Date(),
      };
    }

    this.logger.log(
      `Successfully scraped ${scrapedPages.length}/${urlsToAnalyze.length} competitors`,
    );

    // 3. Optionally check backlinks via Ahrefs
    if (resolvedOptions.includeBacklinks) {
      await this.enrichWithBacklinks(scrapedPages);
    }

    // 4. Optionally run Lighthouse performance audit
    if (resolvedOptions.includeLighthouse) {
      await this.enrichWithLighthouse(scrapedPages);
    }

    // 5. DeepSeek comprehensive analysis
    let deepSeekAnalysis: DeepSeekAnalysis | null = null;
    try {
      deepSeekAnalysis = await this.analyzeWithDeepSeek(scrapedPages, keyword);
      this.logger.log('DeepSeek competitive analysis completed');
    } catch (error) {
      this.logger.error(`DeepSeek analysis failed: ${(error as Error).message}`);
    }

    // 6. Save to DB
    try {
      await this.saveAnalysis(keyword, scrapedPages, deepSeekAnalysis);
      this.logger.log('Competitor analysis saved to database');
    } catch (error) {
      this.logger.error(`Failed to save competitor analysis: ${(error as Error).message}`);
    }

    // 7. Build response
    const duration = Date.now() - startTime;
    this.logger.log(
      `Competitor analysis completed for "${keyword}" in ${duration}ms (${scrapedPages.length} competitors)`,
    );

    return {
      id: uuidv4(),
      keyword,
      competitors: scrapedPages,
      summary: deepSeekAnalysis,
      opportunities: deepSeekAnalysis?.opportunities ?? [],
      contentGaps: deepSeekAnalysis?.contentGaps ?? [],
      analyzedAt: new Date(),
    };
  }

  /**
   * Analyze a single competitor URL and return structured page data.
   *
   * Extracts:
   *   - title, meta description
   *   - h1-h6 headings with hierarchy
   *   - word count
   *   - readability (Flesch-Kincaid)
   *   - internal / external links
   *   - images with alt text
   *   - schema.org types (JSON-LD)
   *   - FAQ data (FAQPage schema)
   *   - Open Graph tags
   *   - canonical URL
   */
  async analyzeSingleCompetitor(url: string, keyword?: string): Promise<ScrapedPage> {
    this.logger.debug(`Analyzing single competitor: ${url}`);

    const scraped = await this.scrapePage(url);

    if (!scraped) {
      this.logger.warn(`Primary scrape failed for ${url}, trying fallback`);
      const fallbackContent = await this.fallbackToFallbackProvider(url);
      if (!fallbackContent) {
        throw new Error(`Failed to scrape ${url} after primary and fallback attempts`);
      }
      return fallbackContent;
    }

    return scraped;
  }

  /**
   * Fallback scraping method — uses a simpler HTTP GET approach
   * with native fetch and different headers if the primary method fails.
   */
  async fallbackToFallbackProvider(url: string): Promise<ScrapedPage | null> {
    this.logger.debug(`Fallback scraping: ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; AutoBlogBot/1.0; +https://autoblog.ai/bot)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.warn(`Fallback fetch returned ${response.status} for ${url}`);
        return null;
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const baseUrl = this.extractBaseUrl($, url);

      return this.buildScrapedPage($, url, baseUrl, 0);
    } catch (error) {
      this.logger.error(`Fallback scraping failed for ${url}: ${(error as Error).message}`);
      return null;
    }
  }

  // =========================================================================
  // SERP fetching
  // =========================================================================

  /**
   * Fetch organic SERP result URLs from Google.
   *
   * Priority:
   *   1. SerpAPI (if configured)
   *   2. Google Custom Search JSON API (if configured)
   *   3. Direct Google scraping (no-API fallback)
   */
  async fetchSERPResults(
    keyword: string,
    country = 'US',
    language = 'en',
  ): Promise<string[]> {
    this.logger.debug(`Fetching SERP results for "${keyword}" (${country}/${language})`);

    if (this.serpApiKey) {
      try {
        return await this.fetchFromSerpApi(keyword, country, language);
      } catch (error) {
        this.logger.warn(`SerpAPI failed: ${(error as Error).message}`);
      }
    }

    if (this.googleApiKey && this.googleCx) {
      try {
        return await this.fetchFromGoogleCse(keyword);
      } catch (error) {
        this.logger.warn(`Google CSE failed: ${(error as Error).message}`);
      }
    }

    try {
      return await this.scrapeGoogleSerp(keyword, country, language);
    } catch (error) {
      this.logger.error(`All SERP methods failed for "${keyword}": ${(error as Error).message}`);
      return [];
    }
  }

  private async fetchFromSerpApi(
    keyword: string,
    country: string,
    language: string,
  ): Promise<string[]> {
    const params = new URLSearchParams({
      q: keyword,
      api_key: this.serpApiKey,
      engine: 'google',
      google_domain: 'google.com',
      hl: language,
      gl: country,
      num: '10',
      device: 'desktop',
    });

    const response = await firstValueFrom(
      this.httpService.get(`https://serpapi.com/search?${params.toString()}`, {
        timeout: this.requestTimeout,
      }),
    );

    const organic = response.data?.organic_results ?? [];
    const urls: string[] = [];

    for (const result of organic) {
      if (result.link && this.isValidUrl(result.link)) {
        urls.push(result.link);
      }
    }

    return urls;
  }

  private async fetchFromGoogleCse(keyword: string): Promise<string[]> {
    const params = new URLSearchParams({
      key: this.googleApiKey,
      cx: this.googleCx,
      q: keyword,
      num: '10',
    });

    const response = await firstValueFrom(
      this.httpService.get(
        `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
        { timeout: this.requestTimeout },
      ),
    );

    const items = response.data?.items ?? [];
    return items
      .filter((item: any) => item.link && this.isValidUrl(item.link))
      .map((item: any) => item.link);
  }

  private async scrapeGoogleSerp(
    keyword: string,
    country: string,
    _language: string,
  ): Promise<string[]> {
    const glParam = country ? `&gl=${country.toLowerCase()}` : '';
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&num=10${glParam}`;

    const response = await firstValueFrom(
      this.httpService.get(searchUrl, {
        headers: {
          'User-Agent': pickUserAgent(),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
        timeout: this.requestTimeout,
        responseType: 'text',
      }),
    );

    const html = typeof response.data === 'string' ? response.data : String(response.data);
    const $ = cheerio.load(html);
    const urls: string[] = [];
    const seen = new Set<string>();

    // Try various Google SERP selectors
    const selectors = [
      'a[href^="/url?q="]',
      'div.yuRUbf a',
      'div.g a[href^="http"]',
      'a[ping]',
      'h3 a',
    ];

    for (const selector of selectors) {
      $(selector).each((_i, el) => {
        let href = $(el).attr('href');
        if (!href) return;

        if (href.startsWith('/url?q=')) {
          try {
            const parsed = new URLSearchParams(href.replace('/url?', ''));
            href = parsed.get('q') ?? href;
          } catch {
            return;
          }
        }

        if (!this.isValidUrl(href)) return;
        if (seen.has(href)) return;

        try {
          const urlObj = new URL(href);
          if (
            urlObj.hostname.includes('google.') ||
            urlObj.hostname === 'youtube.com' ||
            href.includes('googleads') ||
            href.includes('aclk')
          ) {
            return;
          }

          seen.add(href);
          urls.push(href);
        } catch {
          // Invalid URL, skip
        }
      });
    }

    return urls.slice(0, 10);
  }

  // =========================================================================
  // Page scraping
  // =========================================================================

  /**
   * Fetch a page's HTML, parse it with cheerio, and extract all data points.
   */
  async scrapePage(url: string): Promise<ScrapedPage | null> {
    const startTime = Date.now();
    this.logger.debug(`Scraping: ${url}`);

    try {
      const config: AxiosRequestConfig = {
        headers: {
          'User-Agent': pickUserAgent(),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          DNT: '1',
          Connection: 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
        },
        timeout: this.requestTimeout,
        maxRedirects: 5,
        responseType: 'text',
        decompress: true,
      };

      const response = await firstValueFrom(this.httpService.get(url, config));
      const responseTimeMs = Date.now() - startTime;
      const html = typeof response.data === 'string' ? response.data : String(response.data);

      const $ = cheerio.load(html);
      const baseUrl = this.extractBaseUrl($, url);

      const page = this.buildScrapedPage($, url, baseUrl, responseTimeMs);
      page.contentType = response.headers['content-type'] ?? null;
      page.lastModified = response.headers['last-modified']
        ? String(response.headers['last-modified'])
        : null;

      return page;
    } catch (error) {
      this.logger.warn(
        `Failed to scrape ${url}: ${(error as AxiosError).message ?? (error as Error).message}`,
      );
      return null;
    }
  }

  private extractBaseUrl($: cheerio.CheerioAPI, fallbackUrl: string): string {
    const canonical = $('link[rel="canonical"]').attr('href');
    if (canonical) return canonical;
    try {
      const parsed = new URL(fallbackUrl);
      return `${parsed.protocol}//${parsed.hostname}`;
    } catch {
      return fallbackUrl;
    }
  }

  private buildScrapedPage(
    $: cheerio.CheerioAPI,
    url: string,
    baseUrl: string,
    responseTimeMs: number,
  ): ScrapedPage {
    // Clone and strip non-content elements for text analysis
    const $content = $.clone();
    $content('script, style, noscript, svg, canvas, iframe, [hidden], template').remove();

    const title = $('title').first().text().trim() || '';
    const metaDescription = $('meta[name="description"]').attr('content')?.trim() ?? '';

    const headings = this.extractHeadings($);
    const textContent = $content('body').text();
    const wordCount = this.countWords(textContent);
    const readability = this.calculateReadability(textContent);
    const internalLinks = this.extractInternalLinks($, baseUrl);
    const externalLinks = this.extractExternalLinks($);
    const images = this.extractImages($);
    const schemaTypes = this.extractSchemaTypes($);
    const faqData = this.extractFAQ($);

    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() ?? null;
    const ogDescription = $('meta[property="og:description"]').attr('content')?.trim() ?? null;
    const ogImage = $('meta[property="og:image"]').attr('content')?.trim() ?? null;
    const metaRobots = $('meta[name="robots"]').attr('content')?.trim() ?? null;
    const langAttr = $('html').attr('lang') ?? $('html').attr('xml:lang') ?? null;

    return {
      url,
      title,
      metaDescription,
      headings,
      wordCount,
      readabilityScore: readability.readingEase,
      readabilityGrade: readability.gradeLevel,
      internalLinks,
      externalLinks,
      images,
      schemaTypes,
      faqData,
      textContent,
      canonicalUrl: $('link[rel="canonical"]').attr('href') ?? null,
      ogImage,
      ogTitle,
      ogDescription,
      favicon:
        $('link[rel="icon"]').attr('href') ??
        $('link[rel="shortcut icon"]').attr('href') ??
        null,
      language: langAttr,
      hasMetaRobots: !!metaRobots,
      metaRobots,
      lastModified: null,
      contentType: null,
      responseTimeMs,
    };
  }

  // =========================================================================
  // Extraction helpers
  // =========================================================================

  /**
   * Extract structured heading data (h1-h6) preserving hierarchy.
   */
  extractHeadings($: cheerio.CheerioAPI): HeadingData[] {
    const headings: HeadingData[] = [];
    for (let level = 1; level <= 6; level++) {
      const tag = `h${level}`;
      $(tag).each((_i, el) => {
        const text = $(el).text().trim();
        if (text) {
          headings.push({ level, text, tag });
        }
      });
    }
    return headings;
  }

  /**
   * Extract all schema.org types found in JSON-LD script tags.
   */
  extractSchemaTypes($: cheerio.CheerioAPI): string[] {
    const types = new Set<string>();

    $('script[type="application/ld+json"]').each((_i, el) => {
      const raw = $(el).html();
      if (!raw) return;

      try {
        const parsed = JSON.parse(raw);
        const schemas = Array.isArray(parsed) ? parsed : [parsed];

        for (const schema of schemas) {
          this.collectTypes(schema, types);

          if (schema['@graph'] && Array.isArray(schema['@graph'])) {
            for (const item of schema['@graph']) {
              this.collectTypes(item, types);
            }
          }
        }
      } catch {
        // Malformed JSON-LD
      }
    });

    return [...types].sort();
  }

  private collectTypes(obj: Record<string, unknown>, types: Set<string>): void {
    if (!obj || typeof obj !== 'object') return;

    const typeValue = obj['@type'];
    if (typeValue) {
      const typeNames = Array.isArray(typeValue) ? typeValue : [typeValue];
      for (const tn of typeNames) {
        if (typeof tn === 'string' && tn) types.add(tn);
      }
    }

    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            this.collectTypes(item as Record<string, unknown>, types);
          }
        }
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.collectTypes(value as Record<string, unknown>, types);
      }
    }
  }

  /**
   * Extract FAQ data from FAQPage schema.org markup.
   * Falls back to HTML structure analysis if no structured data found.
   */
  extractFAQ($: cheerio.CheerioAPI): FaqItem[] | null {
    const faqItems: FaqItem[] = [];

    $('script[type="application/ld+json"]').each((_i, el) => {
      const raw = $(el).html();
      if (!raw) return;

      try {
        const parsed = JSON.parse(raw);
        const schemas = Array.isArray(parsed) ? parsed : [parsed];

        for (const schema of schemas) {
          if (schema['@type'] === 'FAQPage' || schema['@type'] === 'FAQ') {
            const extracted = this.extractFaqFromSchema(schema);
            faqItems.push(...extracted);
          }

          if (schema['@graph'] && Array.isArray(schema['@graph'])) {
            for (const item of schema['@graph']) {
              if (item['@type'] === 'FAQPage' || item['@type'] === 'FAQ') {
                const extracted = this.extractFaqFromSchema(item);
                faqItems.push(...extracted);
              }
            }
          }
        }
      } catch {
        // Ignore
      }
    });

    if (faqItems.length === 0) {
      const htmlFaq = this.extractFaqFromHtml($);
      faqItems.push(...htmlFaq);
    }

    return faqItems.length > 0 ? faqItems : null;
  }

  private extractFaqFromSchema(schema: Record<string, unknown>): FaqItem[] {
    const items: FaqItem[] = [];

    const mainEntity = schema['mainEntity'];
    if (Array.isArray(mainEntity)) {
      for (const entity of mainEntity) {
        if (entity && typeof entity === 'object' && (entity as Record<string, unknown>)['@type'] === 'Question') {
          const q = (entity as Record<string, unknown>).name as string ?? '';
          const answerObj = (entity as Record<string, unknown>).acceptedAnswer as Record<string, unknown> ?? {};
          const a = (answerObj.text as string ?? '') || (answerObj['@type'] as string ?? '');
          if (q && a) {
            items.push({ question: q.trim(), answer: a.trim() });
          }
        }
      }
    }

    const questions = schema['question'] ?? schema['questions'] ?? [];
    const answers = schema['answer'] ?? schema['answers'] ?? [];
    if (Array.isArray(questions)) {
      for (let i = 0; i < questions.length; i++) {
        const q = typeof questions[i] === 'string' ? questions[i] : '';
        const a = Array.isArray(answers) && i < answers.length ? answers[i] : '';
        if (q && a) {
          items.push({ question: q.trim(), answer: String(a).trim() });
        }
      }
    }

    return items;
  }

  private extractFaqFromHtml($: cheerio.CheerioAPI): FaqItem[] {
    const items: FaqItem[] = [];

    const faqSelectors = [
      '[class*="faq"]', '[class*="FAQ"]', '[id*="faq"]',
      '[class*="accordion"]', '[class*="Accordion"]',
      'details',
    ];

    for (const selector of faqSelectors) {
      $(selector).each((_i, container) => {
        $(container)
          .find('[class*="question"], [class*="Question"], dt, summary, [class*="faq-q"]')
          .each((_j, qEl) => {
            const question = $(qEl).text().trim();
            if (!question) return;

            let answer = '';
            const nextEl = $(qEl).next();
            if (
              nextEl.length &&
              (nextEl.is('dd') ||
                nextEl.is('[class*="answer"]') ||
                nextEl.is('[class*="Answer"]') ||
                nextEl.is('[class*="faq-a"]') ||
                nextEl.is('[class*="content"]'))
            ) {
              answer = nextEl.text().trim();
            } else {
              const parent = $(qEl).parent();
              answer =
                parent.find('[class*="answer"], [class*="Answer"], [class*="faq-a"]').first().text().trim() ||
                parent.find('p').first().text().trim();
            }

            if (answer) {
              items.push({ question, answer: answer.slice(0, 500) });
            }
          });
      });

      if (items.length > 0) break;
    }

    return items.slice(0, 20);
  }

  /**
   * Count words in text accurately, handling HTML entities and special characters.
   */
  countWords(text: string): number {
    if (!text || text.trim().length === 0) return 0;

    const clean = text
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^\w\s'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return 0;

    return clean.split(/\s+/).filter((w) => w.length > 0 && /[a-zA-Z0-9]/.test(w)).length;
  }

  /**
   * Calculate Flesch-Kincaid readability metrics (Grade Level + Reading Ease).
   */
  calculateReadability(text: string): {
    gradeLevel: number;
    readingEase: number;
    totalWords: number;
    totalSentences: number;
    totalSyllables: number;
  } {
    return computeFleschKincaid(text);
  }

  /**
   * Extract all same-domain internal links.
   */
  extractInternalLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
    const links = new Set<string>();
    let baseHostname: string;

    try {
      baseHostname = new URL(baseUrl).hostname.replace(/^www\./, '');
    } catch {
      baseHostname = '';
    }

    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href')?.trim();
      if (!href) return;
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('data:') || href.startsWith('blob:')) return;

      try {
        const resolved = new URL(href, baseUrl);
        const resolvedHostname = resolved.hostname.replace(/^www\./, '');

        if (resolvedHostname === baseHostname || !resolvedHostname) {
          const normalized = this.normalizeUrl(resolved.toString());
          if (normalized && this.isValidUrl(normalized)) {
            links.add(normalized);
          }
        }
      } catch {
        // Invalid URL
      }
    });

    return [...links].slice(0, 200);
  }

  /**
   * Extract all external links (different domain from base).
   */
  extractExternalLinks($: cheerio.CheerioAPI): string[] {
    const links = new Set<string>();

    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href')?.trim();
      if (!href) return;
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('data:') || href.startsWith('blob:')) return;

      try {
        const urlObj = new URL(href);
        const hostname = urlObj.hostname.replace(/^www\./, '');

        if (
          hostname &&
          hostname !== 'localhost' &&
          !hostname.startsWith('127.') &&
          !hostname.startsWith('10.') &&
          !hostname.startsWith('192.168.') &&
          hostname.includes('.')
        ) {
          const normalized = this.normalizeUrl(urlObj.toString());
          if (normalized && this.isValidUrl(normalized)) {
            links.add(normalized);
          }
        }
      } catch {
        // Invalid URL
      }
    });

    return [...links].slice(0, 200);
  }

  /**
   * Extract images with src and alt attributes from the page.
   */
  private extractImages($: cheerio.CheerioAPI): Array<{ src: string; alt: string }> {
    const images: Array<{ src: string; alt: string }> = [];
    const seen = new Set<string>();

    $('img[src]').each((_i, el) => {
      let src = $(el).attr('src')?.trim();
      const alt = $(el).attr('alt')?.trim() ?? '';

      if (!src) return;
      if (src.startsWith('data:') || src.startsWith('blob:')) return;

      if (src.startsWith('//')) src = `https:${src}`;

      try {
        const resolved = new URL(src, 'https://example.com');
        const normalized = this.normalizeUrl(resolved.toString());
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          images.push({ src: normalized, alt: alt.length > 200 ? alt.slice(0, 200) : alt });
        }
      } catch {
        // Invalid URL
      }
    });

    return images;
  }

  // =========================================================================
  // Backlink enrichment (Ahrefs)
  // =========================================================================

  private async enrichWithBacklinks(pages: ScrapedPage[]): Promise<void> {
    if (!this.ahrefsApiKey) {
      this.logger.debug('No Ahrefs API key configured, skipping backlink analysis');
      return;
    }

    for (const page of pages) {
      try {
        // Attempt to get backlink stats (mock implementation — real Ahrefs API varies by plan)
        // In production, replace with actual Ahrefs API v3 endpoint
        this.logger.debug(`Backlink check for ${page.url} — requires Ahrefs API integration`);
      } catch (error) {
        this.logger.warn(`Backlink check failed for ${page.url}: ${(error as Error).message}`);
      }
    }
  }

  // =========================================================================
  // Lighthouse enrichment
  // =========================================================================

  private async enrichWithLighthouse(pages: ScrapedPage[]): Promise<void> {
    // Lighthouse audit would typically be done via Chrome DevTools Protocol
    // For server-side use, consider using the PSI API or a headless Chrome
    for (const page of pages) {
      try {
        this.logger.debug(`Lighthouse audit for ${page.url} — requires headless Chrome integration`);
      } catch (error) {
        this.logger.warn(`Lighthouse audit failed for ${page.url}: ${(error as Error).message}`);
      }
    }
  }

  // =========================================================================
  // DeepSeek AI analysis
  // =========================================================================

  /**
   * Send competitor data to DeepSeek for comprehensive strategic analysis.
   *
   * The prompt is engineered for structured JSON output covering:
   *   - Competitive landscape summary
   *   - SWOT analysis
   *   - Content gap identification
   *   - Keyword opportunities
   *   - SEO tactics recommendations
   *   - Topical authority assessment
   *   - Market positioning insights
   */
  async analyzeWithDeepSeek(
    competitors: ScrapedPage[],
    keyword: string,
  ): Promise<DeepSeekAnalysis> {
    this.logger.debug(`Analyzing ${competitors.length} competitors with DeepSeek for "${keyword}"`);

    // Build a compact, structured representation of the competitor data
    const competitorSummaries = competitors.map((c, i) => ({
      rank: i + 1,
      url: c.url,
      title: c.title.slice(0, 200),
      metaDescription: c.metaDescription.slice(0, 300),
      wordCount: c.wordCount,
      readabilityScore: c.readabilityScore,
      readabilityGrade: c.readabilityGrade,
      headingCount: c.headings.length,
      headingsByLevel: this.countHeadingLevels(c.headings),
      internalLinkCount: c.internalLinks.length,
      externalLinkCount: c.externalLinks.length,
      imageCount: c.images.length,
      imagesWithAlt: c.images.filter((img) => img.alt).length,
      imagesWithoutAlt: c.images.filter((img) => !img.alt).length,
      schemaTypes: c.schemaTypes,
      hasFAQ: c.faqData !== null && c.faqData.length > 0,
      faqCount: c.faqData?.length ?? 0,
      hasCanonical: !!c.canonicalUrl,
      hasOGTags: !!(c.ogTitle || c.ogDescription || c.ogImage),
      hasFavicon: !!c.favicon,
      language: c.language,
      h1s: c.headings.filter((h) => h.level === 1).map((h) => h.text.slice(0, 150)),
      h2s: c.headings.filter((h) => h.level === 2).map((h) => h.text.slice(0, 150)),
    }));

    const avgWordCount = competitorSummaries.reduce((sum, c) => sum + c.wordCount, 0) / competitorSummaries.length;
    const avgReadability = competitorSummaries.reduce((sum, c) => sum + c.readabilityScore, 0) / competitorSummaries.length;

    const allSchemaTypes = new Set<string>();
    for (const c of competitorSummaries) {
      for (const st of c.schemaTypes) allSchemaTypes.add(st);
    }

    const allH1s = competitorSummaries.flatMap((c) => c.h1s);
    const allH2s = competitorSummaries.flatMap((c) => c.h2s);

    const prompt = `You are a world-class SEO strategist and competitive analyst. Perform a comprehensive competitive analysis for the keyword "${keyword}" based on detailed page-level data from the top ${competitors.length} organic competitors.

## Aggregate Metrics
- Average word count: ${Math.round(avgWordCount)}
- Average readability score (Flesch Reading Ease): ${Math.round(avgReadability)}
- Total unique schema types: ${allSchemaTypes.size}
- Schema types in use: ${[...allSchemaTypes].join(', ') || 'None detected'}
- Competitors with FAQ schema: ${competitorSummaries.filter((c) => c.hasFAQ).length}/${competitorSummaries.length}

## Per-Competitor Details (JSON)
${JSON.stringify(competitorSummaries, null, 2)}

## All H1 Headings
${allH1s.map((h, i) => `  ${i + 1}. ${h || '(empty)'}`).join('\n') || '  (none detected)'}

## All H2 Headings
${allH2s.map((h, i) => `  ${i + 1}. ${h || '(empty)'}`).join('\n') || '  (none detected)'}

## Analysis Instructions
Provide a comprehensive competitive analysis as valid JSON only — no markdown fences, no extra text. Use this exact schema:

{
  "competitiveLandscape": "2-3 sentence summary of the competitive landscape",
  "strengths": ["3-5 common strengths across competitors"],
  "weaknesses": ["3-5 common weaknesses or gaps across competitors"],
  "opportunities": ["3-5 actionable opportunities to outperform competitors"],
  "threats": ["2-3 market or competitive threats"],
  "contentGaps": [
    {
      "topic": "Specific missing topic or subtopic",
      "priority": "high|medium|low",
      "mentionedIn": [],
      "missingFrom": [],
      "searchVolume_": null,
      "difficulty_": null
    }
  ],
  "recommendedStrategy": "3-4 sentence recommended content and SEO strategy",
  "keywordOpportunities": [
    {
      "keyword": "Related keyword opportunity",
      "rationale": "Why this is an opportunity",
      "priority": "high|medium|low"
    }
  ],
  "seoTactics": ["3-5 specific SEO tactics based on competitor weaknesses"],
  "topicalAuthority": {
    "covered": ["Topics well-covered by competitors"],
    "missing": ["Topics competitors are missing"],
    "recommendations": ["Recommendations for topical authority"]
  },
  "marketPositioning": {
    "pricePoints": ["Observed pricing signals"],
    "uniqueSellingPoints": ["Common USPs found"],
    "targetAudiences": ["Inferred target audiences"]
  }
}`;

    const result = await this.deepSeekService.generateContent(prompt, {
      model: 'deepseek-v4-flash',
      temperature: 0.3,
      maxTokens: 4096,
      responseFormat: 'json_object',
      systemPrompt:
        'You are an expert SEO competitive analyst. You always respond with valid JSON only, no markdown formatting, no code fences, no explanatory text.',
    });

    // Parse the response
    try {
      const cleaned = result.content
        .replace(/```json\s*/gi, '')
        .replace(/```\s*$/gm, '')
        .replace(/```/g, '')
        .trim();

      const analysis = JSON.parse(cleaned) as DeepSeekAnalysis;

      // Validate and ensure all fields exist
      analysis.contentGaps = analysis.contentGaps ?? [];
      analysis.opportunities = analysis.opportunities ?? [];
      analysis.strengths = analysis.strengths ?? [];
      analysis.weaknesses = analysis.weaknesses ?? [];
      analysis.threats = analysis.threats ?? [];
      analysis.keywordOpportunities = analysis.keywordOpportunities ?? [];
      analysis.seoTactics = analysis.seoTactics ?? [];
      analysis.competitiveLandscape = analysis.competitiveLandscape ?? '';
      analysis.recommendedStrategy = analysis.recommendedStrategy ?? '';

      if (!analysis.topicalAuthority) {
        analysis.topicalAuthority = { covered: [], missing: [], recommendations: [] };
      }
      if (!analysis.marketPositioning) {
        analysis.marketPositioning = { pricePoints: [], uniqueSellingPoints: [], targetAudiences: [] };
      }

      return analysis;
    } catch (parseError) {
      this.logger.error(`Failed to parse DeepSeek analysis JSON: ${(parseError as Error).message}`);
      this.logger.debug(`Raw response preview: ${result.content.slice(0, 500)}`);

      return {
        competitiveLandscape: '',
        strengths: [],
        weaknesses: [],
        opportunities: [],
        threats: [],
        contentGaps: [],
        recommendedStrategy: '',
        keywordOpportunities: [],
        seoTactics: [],
        topicalAuthority: { covered: [], missing: [], recommendations: [] },
        marketPositioning: { pricePoints: [], uniqueSellingPoints: [], targetAudiences: [] },
      };
    }
  }

  // =========================================================================
  // Database persistence
  // =========================================================================

  /**
   * Save competitor analysis results to the database.
   * Creates/updates Competitor records linked to the project.
   */
  async saveAnalysis(
    keyword: string,
    competitors: ScrapedPage[],
    deepSeekAnalysis: DeepSeekAnalysis | null,
  ): Promise<void> {
    let projectId: string | null = null;

    try {
      const keywordRecord = await this.prisma.keyword.findFirst({
        where: { term: { equals: keyword, mode: 'insensitive' } },
        select: { projectId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (keywordRecord) projectId = keywordRecord.projectId;
    } catch {
      this.logger.debug('Could not find project for keyword');
    }

    for (const competitor of competitors) {
      try {
        const existing = await this.prisma.competitor.findFirst({
          where: { url: competitor.url },
        });

        const data = {
          title: competitor.title.slice(0, 500) || null,
          metaDescription: competitor.metaDescription.slice(0, 500) || null,
          wordCount: competitor.wordCount || null,
          headingCount: competitor.headings.length || null,
          internalLinks: competitor.internalLinks.length || null,
          externalLinks: competitor.externalLinks.length || null,
          images: competitor.images.length || null,
          readabilityScore: competitor.readabilityScore || null,
          schemaTypes: competitor.schemaTypes,
          contentGaps: deepSeekAnalysis?.contentGaps
            ? JSON.parse(JSON.stringify(deepSeekAnalysis.contentGaps))
            : undefined,
          projectId: projectId ?? undefined,
        };

        if (existing) {
          await this.prisma.competitor.update({
            where: { id: existing.id },
            data: { ...data, updatedAt: new Date() },
          });
        } else {
          await this.prisma.competitor.create({
            data: {
              ...data,
              url: competitor.url,
              projectId: projectId ?? (await this.ensureDefaultProject()),
            },
          });
        }
      } catch (dbError) {
        this.logger.error(`Failed to save competitor ${competitor.url}: ${(dbError as Error).message}`);
      }
    }

    // Audit log
    if (deepSeekAnalysis) {
      try {
        await this.prisma.auditLog.create({
          data: {
            action: 'COMPETITOR_ANALYSIS',
            resource: 'competitor',
            resourceId: keyword,
            metadata: {
              keyword,
              competitorCount: competitors.length,
              opportunityCount: deepSeekAnalysis.opportunities.length,
              contentGapCount: deepSeekAnalysis.contentGaps.length,
              analyzedAt: new Date().toISOString(),
            },
          },
        });
      } catch {
        // Non-critical
      }
    }
  }

  /**
   * Ensure there is at least one project to associate competitors with.
   * Creates a default "Competitor Research" project if none exists.
   */
  private async ensureDefaultProject(): Promise<string> {
    const existing = await this.prisma.project.findFirst({
      orderBy: { createdAt: 'asc' },
    });

    if (existing) return existing.id;

    const firstUser = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!firstUser) throw new Error('No user found to create default project');

    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId: firstUser.id },
      select: { organizationId: true },
    });

    const project = await this.prisma.project.create({
      data: {
        name: 'Competitor Research',
        slug: 'competitor-research',
        description: 'Auto-generated project for competitor analysis',
        status: 'ACTIVE' as any,
        userId: firstUser.id,
        organizationId: membership?.organizationId ?? null,
      },
    });

    return project.id;
  }

  // =========================================================================
  // Utility helpers
  // =========================================================================

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.hostname.includes('.') &&
        parsed.hostname.length > 3
      );
    } catch {
      return false;
    }
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);

      const trackingParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
        'msclkid', 'twclid', 'sc_campaign', 'sc_channel', 'sc_content',
        'sc_geo', 'sc_medium', 'sc_outcome', 'sc_reader', 'sc_seller',
        'sc_tracker', 's_kwcid', 'yclid', '_ga', '_gl', 'utm_id',
        'pk_source', 'pk_medium', 'pk_campaign', 'pk_keyword', 'pk_content',
        'mtm_source', 'mtm_medium', 'mtm_campaign', 'mtm_keyword', 'mtm_content',
        'mtm_cid', 'mtm_group', 'mtm_placement',
      ];

      for (const param of trackingParams) {
        parsed.searchParams.delete(param);
      }

      parsed.hash = '';
      parsed.hostname = parsed.hostname.toLowerCase();

      if ((parsed.protocol === 'https:' && parsed.port === '443') ||
          (parsed.protocol === 'http:' && parsed.port === '80')) {
        parsed.port = '';
      }

      let normalized = parsed.toString();
      if (normalized.endsWith('/') && !normalized.endsWith('//')) {
        normalized = normalized.slice(0, -1);
      }

      return normalized;
    } catch {
      return url;
    }
  }

  private countHeadingLevels(headings: HeadingData[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (let i = 1; i <= 6; i++) counts[`h${i}`] = 0;
    for (const h of headings) {
      const key = `h${h.level}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }
}

import {
  Injectable,
  Logger,
  Inject,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../database/prisma.service';
import { DeepSeekService } from '../../ai/providers/deepseek.service';
import { ImageGeneratorService } from '../images/image-generator.service';
import { SeoOptimizerService } from '../seo/seo-optimizer.service';
import { UpdateArticleDto } from './dto/update-article.dto';

// ─────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────

export interface GenerateArticleOptions {
  wordCount?: number;
  tone?: string;
  style?: string;
  audience?: string;
  primaryKeywords?: string[];
  secondaryKeywords?: string[];
  mustInclude?: string[];
  generateImages?: boolean;
  aiDetection?: boolean;
  stream?: boolean;
  contentGaps?: Array<{
    competitorUrl?: string;
    topic?: string;
    missingTopics?: string[];
  }>;
  internalLinkingUrls?: string[];
  additionalInstructions?: string;
  projectId?: string;
  headingCount?: number;
  includeFAQ?: boolean;
  includeTOC?: boolean;
}

export interface ArticleMetadata {
  metaTitle: string;
  metaDescription: string;
  slug: string;
  ogTitle: string;
  ogDescription: string;
  twitterTitle: string;
  twitterDescription: string;
}

export interface GeneratedContent {
  introduction: string;
  sections: Array<{
    heading: string;
    content: string;
  }>;
  conclusion: string;
  faq?: Array<{
    question: string;
    answer: string;
  }>;
  cta?: string;
  toc?: string;
}

export interface ArticleFilter {
  page: number;
  limit: number;
  status?: string;
  search?: string;
  projectId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ProgressEvent {
  step: string;
  progress: number;
  message?: string;
  articleId?: string;
}

// ─────────────────────────────────────────────────────────────
// Regeneration Options
// ─────────────────────────────────────────────────────────────

export interface RegenerateOptions {
  preserveImages?: boolean;
  tone?: string;
  style?: string;
  regenerateMetadata?: boolean;
  regenerateContent?: boolean;
  regenerateImages?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class BlogGeneratorService {
  private readonly logger = new Logger(BlogGeneratorService.name);

  // Default generation options
  private readonly DEFAULTS = {
    wordCount: 1500,
    tone: 'professional',
    style: 'guide',
    audience: 'general',
    headingCount: 6,
    includeFAQ: true,
    includeTOC: true,
    generateImages: true,
    aiDetection: true,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly deepseek: DeepSeekService,
    private readonly imageGenerator: ImageGeneratorService,
    private readonly seoOptimizer: SeoOptimizerService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue('articles') private readonly articlesQueue: Queue,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    this.logger.log('BlogGeneratorService initialized');
  }

  // ─────────────────────────────────────────────────────────────
  // 1. generateArticle - 7-step pipeline
  // ─────────────────────────────────────────────────────────────

  /**
   * Full 7-step article generation pipeline.
   * 1. generateMetadata() - SEO title, slug, meta/OG/Twitter tags
   * 2. generateContent() - Full article via DeepSeek
   * 3. generateImages() - Parallel image generation
   * 4. seoOptimize() - SEO optimization
   * 5. aiDetectionCheck() - AI detection score
   * 6. humanizeContent() - Rewrite if score > 0.3
   * 7. assembleAndSave() - Combine, save to DB, return
   */
  async generateArticle(
    title: string,
    topic: string,
    options?: GenerateArticleOptions,
    brief?: string,
  ): Promise<any> {
    this.logger.log(`Starting article generation: "${title}" (topic: "${topic}")`);

    const opts = { ...this.DEFAULTS, ...options };
    const projectId = opts.projectId || null;
    const articleId = uuidv4();

    try {
      // ── Step 1: Generate Metadata ────────────────────────────
      this.emitProgress('generateMetadata', 10, 'Generating SEO metadata...', articleId);
      const keywords = [
        ...(opts.primaryKeywords || []),
        ...(opts.secondaryKeywords || []),
      ];
      const metadata = await this.generateMetadata(title, topic, keywords);
      this.logger.log(`Metadata generated: slug="${metadata.slug}"`);

      // ── Step 2: Generate Content ─────────────────────────────
      this.emitProgress('generateContent', 30, 'Writing article content...', articleId);
      const content = await this.generateContent(metadata, opts, brief);
      this.logger.log(`Content generated: ${this.countWords(content.introduction + content.sections.map(s => s.content).join(' ') + content.conclusion)} words`);

      // ── Step 3: Generate Images ──────────────────────────────
      const images: string[] = [];
      if (opts.generateImages) {
        this.emitProgress('generateImages', 50, 'Generating article images...', articleId);
        try {
          const generatedImages = await this.generateImages(title, topic, content, opts);
          images.push(...generatedImages);
          this.logger.log(`Generated ${generatedImages.length} images`);
        } catch (imgError) {
          this.logger.warn(`Image generation failed, continuing without images: ${(imgError as Error).message}`);
        }
      }

      // ── Step 4: SEO Optimize ────────────────────────────────
      this.emitProgress('seoOptimize', 65, 'Optimizing for SEO...', articleId);
      const fullHtml = this.assembleContentHtml(content, metadata, images);
      let seoResult: any = null;
      try {
        seoResult = await this.seoOptimizer.optimize(fullHtml, opts.primaryKeywords?.[0] || topic, {
          title: metadata.metaTitle,
          metaDescription: metadata.metaDescription,
        });
        this.logger.log(`SEO optimization complete, score: ${seoResult?.estimatedScore || 'N/A'}`);
      } catch (seoError) {
        this.logger.warn(`SEO optimization failed, continuing: ${(seoError as Error).message}`);
      }

      // ── Step 5: AI Detection Check ──────────────────────────
      this.emitProgress('aiDetectionCheck', 80, 'Running AI detection analysis...', articleId);
      const fullText = this.extractPlainText(fullHtml);
      let aiDetectionScore = 0;
      if (opts.aiDetection) {
        try {
          aiDetectionScore = await this.aiDetectionCheck(fullText);
          this.logger.log(`AI detection score: ${aiDetectionScore}`);
        } catch (detectError) {
          this.logger.warn(`AI detection check failed, assuming score 0: ${(detectError as Error).message}`);
        }
      }

      // ── Step 6: Humanize if needed ─────────────────────────
      let finalContent = fullHtml;
      let humanized = false;
      if (aiDetectionScore > 0.3) {
        this.emitProgress('humanizeContent', 90, 'Humanizing content...', articleId);
        try {
          finalContent = await this.humanizeContent(fullText);
          humanized = true;
          this.logger.log(`Content humanized (score was ${aiDetectionScore})`);
        } catch (humanizeError) {
          this.logger.warn(`Humanization failed, using original: ${(humanizeError as Error).message}`);
          finalContent = fullHtml;
        }
      }

      // ── Step 7: Assemble & Save ─────────────────────────────
      this.emitProgress('assembleAndSave', 95, 'Assembling and saving article...', articleId);
      const wordCount = this.countWords(
        humanized ? finalContent : fullText,
      );
      const readingTime = this.estimateReadingTime(
        humanized ? finalContent : fullText,
        images.length,
      );

      const savedArticle = await this.saveArticle({
        id: articleId,
        title,
        slug: metadata.slug,
        metaTitle: metadata.metaTitle,
        metaDescription: metadata.metaDescription,
        ogTitle: metadata.ogTitle,
        ogDescription: metadata.ogDescription,
        twitterCard: metadata.twitterDescription,
        introduction: content.introduction,
        tableOfContents: content.toc ? { html: content.toc } : null,
        content: finalContent,
        faq: content.faq || null,
        conclusion: content.conclusion,
        cta: content.cta || null,
        images,
        featuredImage: images[0] || null,
        seoScore: seoResult?.estimatedScore || null,
        aiDetectionScore: humanized ? Math.max(0, aiDetectionScore - 0.15) : aiDetectionScore,
        wordCount,
        readingTime,
        projectId,
        status: 'DRAFT',
        tone: opts.tone,
        style: opts.style,
        audience: opts.audience,
        keywords,
      });

      this.emitProgress('complete', 100, 'Article generation complete!', articleId);
      this.logger.log(`Article "${title}" generated successfully (id=${savedArticle.id})`);

      return savedArticle;
    } catch (error) {
      this.logger.error(`Article generation failed: ${(error as Error).message}`, (error as Error).stack);
      this.emitProgress('error', 0, `Generation failed: ${(error as Error).message}`, articleId);
      throw new InternalServerErrorException(
        `Article generation failed: ${(error as Error).message}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 2. generateMetadata
  // ─────────────────────────────────────────────────────────────

  /**
   * Generate SEO metadata (title, description, slug, OG/Twitter tags)
   * using DeepSeek with model deepseek-reasoner at temperature 0.3.
   */
  async generateMetadata(
    title: string,
    topic: string,
    keywords?: string[],
  ): Promise<ArticleMetadata> {
    this.logger.log(`Generating SEO metadata for: "${title}"`);

    const keywordStr = keywords?.length ? keywords.join(', ') : topic;
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.deepseek.generateContent(
          this.buildMetadataPrompt(title, topic, keywordStr),
          {
            model: 'deepseek-reasoner',
            temperature: 0.3,
            maxTokens: 1024,
            responseFormat: 'json_object' as any,
            systemPrompt:
              'You are an expert SEO strategist. Generate optimized metadata for blog content. ' +
              'Return ONLY valid JSON. Follow these guidelines:\n' +
              '- metaTitle: 50-60 characters, include primary keyword near the beginning\n' +
              '- metaDescription: 150-160 characters, compelling, include keyword and call to action\n' +
              '- slug: URL-friendly, 3-6 words, lowercase, hyphens, no stop words\n' +
              '- ogTitle: 40-50 characters, optimized for social sharing\n' +
              '- ogDescription: 60-70 characters, engaging for social platforms\n' +
              '- twitterTitle: 40-50 characters, optimized for Twitter/X\n' +
              '- twitterDescription: 60-70 characters, concise for Twitter/X',
          },
        );

        const parsed = JSON.parse(response.content);
        const metadata: ArticleMetadata = {
          metaTitle: parsed.metaTitle || title.substring(0, 60),
          metaDescription: parsed.metaDescription || this.truncateText(topic, 160),
          slug: parsed.slug || this.slugify(title),
          ogTitle: parsed.ogTitle || parsed.metaTitle || title.substring(0, 50),
          ogDescription: parsed.ogDescription || parsed.metaDescription || this.truncateText(topic, 70),
          twitterTitle: parsed.twitterTitle || parsed.ogTitle || title.substring(0, 50),
          twitterDescription: parsed.twitterDescription || parsed.ogDescription || this.truncateText(topic, 70),
        };

        // Validate and clean
        metadata.metaTitle = this.truncateText(metadata.metaTitle, 60);
        metadata.metaDescription = this.truncateText(metadata.metaDescription, 160);
        metadata.ogTitle = this.truncateText(metadata.ogTitle, 50);
        metadata.ogDescription = this.truncateText(metadata.ogDescription, 70);
        metadata.twitterTitle = this.truncateText(metadata.twitterTitle, 50);
        metadata.twitterDescription = this.truncateText(metadata.twitterDescription, 70);

        if (!metadata.slug || metadata.slug.length < 2) {
          metadata.slug = this.slugify(title);
        }

        return metadata;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Metadata generation attempt ${attempt + 1}/${maxRetries} failed: ${lastError.message}`,
        );
        if (attempt < maxRetries - 1) {
          await this.delay(1000 * (attempt + 1));
        }
      }
    }

    // Fallback: generate basic metadata without AI
    this.logger.warn('Using fallback metadata generation');
    return {
      metaTitle: title.substring(0, 60),
      metaDescription: this.truncateText(topic, 160),
      slug: this.slugify(title),
      ogTitle: title.substring(0, 50),
      ogDescription: this.truncateText(topic, 70),
      twitterTitle: title.substring(0, 50),
      twitterDescription: this.truncateText(topic, 70),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 3. generateContent
  // ─────────────────────────────────────────────────────────────

  /**
   * Generate full article content using DeepSeek.
   * Uses buildArticlePrompt() and getArticleSystemPrompt().
   * Model: deepseek-reasoner, temperature 0.7.
   */
  async generateContent(
    metadata: ArticleMetadata,
    options: GenerateArticleOptions,
    brief?: string,
  ): Promise<GeneratedContent> {
    this.logger.log('Generating article content...');

    const prompt = this.buildArticlePrompt(metadata, options, brief);
    const systemPrompt = this.getArticleSystemPrompt();

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.deepseek.generateContent(prompt, {
          model: 'deepseek-reasoner',
          temperature: 0.7,
          maxTokens: 8192,
          responseFormat: 'json_object' as any,
          systemPrompt,
        });

        const parsed = JSON.parse(response.content);

        const content: GeneratedContent = {
          introduction: parsed.introduction || '',
          sections: Array.isArray(parsed.sections)
            ? parsed.sections.map((s: any) => ({
                heading: s.heading || '',
                content: s.content || '',
              }))
            : [],
          conclusion: parsed.conclusion || '',
          faq: Array.isArray(parsed.faq)
            ? parsed.faq.map((f: any) => ({
                question: f.question || '',
                answer: f.answer || '',
              }))
            : undefined,
          cta: parsed.cta || undefined,
          toc: parsed.toc || undefined,
        };

        // Validate - ensure we have at least some content
        if (!content.introduction && content.sections.length === 0) {
          throw new BadRequestException('Generated content is empty or malformed');
        }

        return content;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Content generation attempt ${attempt + 1}/${maxRetries} failed: ${lastError.message}`,
        );
        if (attempt < maxRetries - 1) {
          await this.delay(1500 * (attempt + 1));
        }
      }
    }

    throw new InternalServerErrorException(
      `Content generation failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // 4. generateArticleStream - SSE streaming via Observable
  // ─────────────────────────────────────────────────────────────

  /**
   * Generate article with streaming SSE response.
   * Returns Observable<MessageEvent> for the controller.
   */
  generateArticleStream(
    title: string,
    topic: string,
    options?: GenerateArticleOptions,
    brief?: string,
  ): Observable<MessageEvent> {
    this.logger.log(`Starting streamed article generation: "${title}"`);

    const opts = { ...this.DEFAULTS, ...options };
    const keywords = [
      ...(opts.primaryKeywords || []),
      ...(opts.secondaryKeywords || []),
    ];

    return new Observable<MessageEvent>((subscriber) => {
      const run = async () => {
        try {
          // Step 1: Metadata
          subscriber.next(this.createMessageEvent('progress', {
            step: 'generateMetadata',
            progress: 10,
            message: 'Generating SEO metadata...',
          }));

          const metadata = await this.generateMetadata(title, topic, keywords);

          subscriber.next(this.createMessageEvent('metadata', {
            metadata,
            progress: 20,
          }));

          // Step 2: Stream content generation
          subscriber.next(this.createMessageEvent('progress', {
            step: 'generateContent',
            progress: 30,
            message: 'Writing article content...',
          }));

          const prompt = this.buildArticlePrompt(metadata, opts, brief);
          const systemPrompt = this.getArticleSystemPrompt();

          // Use the DeepSeek streaming observable
          const contentStream = this.deepseek.streamContent(prompt, {
            model: 'deepseek-reasoner',
            temperature: 0.7,
            maxTokens: 8192,
            responseFormat: 'json_object' as any,
            systemPrompt,
          });

          let accumulatedContent = '';

          contentStream.subscribe({
            next: (chunk) => {
              if (chunk.content) {
                accumulatedContent += chunk.content;

                // Send content delta as a stream event
                subscriber.next(this.createMessageEvent('content', {
                  delta: chunk.content,
                  accumulated: accumulatedContent,
                }));
              }
            },
            error: async (err) => {
              this.logger.warn(`Stream error, falling back to non-streaming: ${err.message}`);

              // Fallback to non-streaming
              try {
                const content = await this.generateContent(metadata, opts, brief);
                subscriber.next(this.createMessageEvent('content_complete', { content }));
              } catch (genError) {
                subscriber.error(this.createMessageEvent('error', {
                  message: `Content generation failed: ${(genError as Error).message}`,
                }));
                return;
              }
            },
            complete: async () => {
              try {
                // Parse the accumulated JSON content
                const parsed = JSON.parse(accumulatedContent);
                const content: GeneratedContent = {
                  introduction: parsed.introduction || '',
                  sections: Array.isArray(parsed.sections)
                    ? parsed.sections.map((s: any) => ({
                        heading: s.heading || '',
                        content: s.content || '',
                      }))
                    : [],
                  conclusion: parsed.conclusion || '',
                  faq: Array.isArray(parsed.faq) ? parsed.faq : undefined,
                  cta: parsed.cta || undefined,
                  toc: parsed.toc || undefined,
                };

                subscriber.next(this.createMessageEvent('content_complete', { content }));

                // Step 3: Generate images (if enabled)
                if (opts.generateImages) {
                  subscriber.next(this.createMessageEvent('progress', {
                    step: 'generateImages',
                    progress: 50,
                    message: 'Generating images...',
                  }));

                  try {
                    const images = await this.generateImages(title, topic, content, opts);
                    subscriber.next(this.createMessageEvent('images', { images }));
                  } catch (imgError) {
                    this.logger.warn(`Image generation failed in stream: ${(imgError as Error).message}`);
                  }
                }

                // Step 4: SEO Optimize
                subscriber.next(this.createMessageEvent('progress', {
                  step: 'seoOptimize',
                  progress: 65,
                  message: 'Optimizing for SEO...',
                }));

                try {
                  const fullHtml = this.assembleContentHtml(content, metadata, []);
                  const allKeywords = keywords.length > 0 ? keywords[0] : topic;
                  const seoResult = await this.seoOptimizer.optimize(fullHtml, allKeywords);
                  subscriber.next(this.createMessageEvent('seo', { result: seoResult }));
                } catch (seoError) {
                  this.logger.warn(`SEO optimization failed in stream: ${(seoError as Error).message}`);
                }

                // Step 5: AI Detection Check
                subscriber.next(this.createMessageEvent('progress', {
                  step: 'aiDetectionCheck',
                  progress: 80,
                  message: 'Checking AI detection score...',
                }));

                let aiDetectionScore = 0;
                if (opts.aiDetection) {
                  try {
                    const fullText = this.extractPlainText(accumulatedContent);
                    aiDetectionScore = await this.aiDetectionCheck(fullText);
                  } catch (detectError) {
                    this.logger.warn(`AI detection failed in stream: ${(detectError as Error).message}`);
                  }
                }

                subscriber.next(this.createMessageEvent('ai_detection', { score: aiDetectionScore }));

                // Step 6: Humanize if needed
                let finalContent = accumulatedContent;
                if (aiDetectionScore > 0.3) {
                  subscriber.next(this.createMessageEvent('progress', {
                    step: 'humanizeContent',
                    progress: 90,
                    message: 'Humanizing content...',
                  }));
                  try {
                    const plainText = this.extractPlainText(accumulatedContent);
                    finalContent = await this.humanizeContent(plainText);
                    subscriber.next(this.createMessageEvent('humanized', { original: accumulatedContent, humanized: finalContent }));
                  } catch (humanizeError) {
                    this.logger.warn(`Humanization failed in stream: ${(humanizeError as Error).message}`);
                  }
                }

                // Step 7: Complete
                subscriber.next(this.createMessageEvent('progress', {
                  step: 'complete',
                  progress: 100,
                  message: 'Article generation complete!',
                }));

                subscriber.next(this.createMessageEvent('complete', {
                  title,
                  metadata,
                  content,
                  aiDetectionScore,
                  humanized: aiDetectionScore > 0.3,
                }));

                subscriber.complete();
              } catch (parseError) {
                subscriber.error(this.createMessageEvent('error', {
                  message: `Failed to parse streamed content: ${(parseError as Error).message}`,
                }));
              }
            },
          });
        } catch (error) {
          subscriber.error(this.createMessageEvent('error', {
            message: `Stream generation failed: ${(error as Error).message}`,
          }));
        }
      };

      run();
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 5. buildArticlePrompt
  // ─────────────────────────────────────────────────────────────

  /**
   * Build the comprehensive article generation prompt.
   * Includes title, keywords, word count, audience, tone, style,
   * mustInclude sections, and contentGaps.
   */
  buildArticlePrompt(
    metadata: ArticleMetadata,
    options: GenerateArticleOptions,
    brief?: string,
  ): string {
    const sections: string[] = [];

    sections.push(`# Article Generation Request`);
    sections.push(``);
    sections.push(`## Core Information`);
    sections.push(`- Title: ${metadata.metaTitle || 'Untitled'}`);
    sections.push(`- Meta Description: ${metadata.metaDescription || ''}`);
    sections.push(`- Slug: ${metadata.slug || ''}`);
    sections.push(``);

    if (brief) {
      sections.push(`## Brief / Context`);
      sections.push(brief);
      sections.push(``);
    }

    sections.push(`## Content Specifications`);
    sections.push(`- Target Word Count: ${options.wordCount || this.DEFAULTS.wordCount} words`);
    sections.push(`- Target Audience: ${options.audience || this.DEFAULTS.audience}`);
    sections.push(`- Tone: ${options.tone || this.DEFAULTS.tone}`);
    sections.push(`- Style: ${options.style || this.DEFAULTS.style}`);
    sections.push(`- Number of Sections/Headings: ${options.headingCount || this.DEFAULTS.headingCount}`);
    sections.push(``);

    if (options.primaryKeywords?.length) {
      sections.push(`## Primary Keywords (must include prominently)`);
      options.primaryKeywords.forEach((kw, i) => sections.push(`  ${i + 1}. ${kw}`));
      sections.push(``);
    }

    if (options.secondaryKeywords?.length) {
      sections.push(`## Secondary Keywords (include naturally)`);
      options.secondaryKeywords.forEach((kw, i) => sections.push(`  ${i + 1}. ${kw}`));
      sections.push(``);
    }

    if (options.mustInclude?.length) {
      sections.push(`## Required Sections / Topics (must be covered)`);
      options.mustInclude.forEach((item, i) => sections.push(`  ${i + 1}. ${item}`));
      sections.push(``);
    }

    if (options.contentGaps?.length) {
      sections.push(`## Content Gaps to Address`);
      options.contentGaps.forEach((gap, i) => {
        sections.push(`  ${i + 1}. Competitor URL: ${gap.competitorUrl || 'N/A'}`);
        if (gap.topic) sections.push(`     Topic: ${gap.topic}`);
        if (gap.missingTopics?.length) {
          sections.push(`     Missing topics to cover:`);
          gap.missingTopics.forEach((mt) => sections.push(`       - ${mt}`));
        }
      });
      sections.push(``);
    }

    if (options.internalLinkingUrls?.length) {
      sections.push(`## Internal Links to Include`);
      options.internalLinkingUrls.forEach((url, i) => sections.push(`  ${i + 1}. ${url}`));
      sections.push(``);
    }

    if (options.additionalInstructions) {
      sections.push(`## Additional Instructions`);
      sections.push(options.additionalInstructions);
      sections.push(``);
    }

    sections.push(`## Output Format`);
    sections.push(`Respond with valid JSON in the following structure:`);
    sections.push('```json');
    sections.push('{');
    sections.push('  "introduction": "Compelling opening paragraph (150-250 words)",');
    sections.push('  "sections": [');
    sections.push('    { "heading": "Section heading (H2)", "content": "Section body with sub-points" }');
    sections.push('  ],');
    sections.push('  "conclusion": "Summary and final thoughts (100-200 words)",');
    sections.push('  "faq": [');
    sections.push('    { "question": "FAQ question?", "answer": "Concise answer" }');
    sections.push('  ],');
    sections.push('  "cta": "Call to action text (optional)",');
    sections.push('  "toc": "Table of contents in markdown (optional)"');
    sections.push('}');
    sections.push('```');
    sections.push(``);
    sections.push(`IMPORTANT RULES:`);
    sections.push(`- Write naturally for a ${options.audience || 'general'} audience`);
    sections.push(`- Use a ${options.tone || 'professional'} tone throughout`);
    sections.push(`- Follow ${options.style || 'guide'} article structure`);
    sections.push(`- Include primary keywords in the first 100 words and in at least 3 headings`);
    sections.push(`- Each section should be 200-400 words of rich, valuable content`);
    sections.push(`- Use short paragraphs (2-4 sentences) for readability`);
    sections.push(`- Include transitional phrases between sections`);
    sections.push(`- Back claims with specific examples, data points, or analogies`);
    sections.push(`- Avoid fluff, generic statements, and excessive adverbs`);
    sections.push(`- Write as a human expert, not an AI — vary sentence length and structure`);

    return sections.join('\n');
  }

  // ─────────────────────────────────────────────────────────────
  // 6. getArticleSystemPrompt
  // ─────────────────────────────────────────────────────────────

  /**
   * Elite SEO content writer system prompt with 15 humanization rules.
   */
  getArticleSystemPrompt(): string {
    return `You are an elite SEO content writer and published author with 15+ years of experience creating high-ranking, engaging blog content for top-tier publications.

Your writing is indistinguishable from a human expert: natural, nuanced, and authoritative. You follow these 15 rules to ensure your content reads as human-written:

1. VARY SENTENCE STRUCTURE: Mix short, punchy sentences with longer, more complex ones. Never write three sentences of the same length in a row.

2. EMBRACE IMPERFECTION: Use occasional sentence fragments, rhetorical questions, and conversational asides. Real human writing isn't grammatically perfect.

3. SHOW PERSONALITY: Inject opinion, perspective, and voice. Use "I believe," "in my experience," "the truth is," and other personal framing.

4. USE TRANSITIONAL PHRASES NATURALLY: "Here's the thing," "that said," "on the flip side," "what's interesting is," "let me explain why."

5. INCLUDE SPECIFIC EXAMPLES: Abstract concepts need concrete illustrations. Use metaphors, analogies, and real-world scenarios.

6. WRITE FOR SCANNABILITY: Short paragraphs (2-4 sentences). Use bold for key takeaways. Break up walls of text.

7. AVOID AI HALLMARKS: Never start with "In today's digital landscape," "In this article, we will explore," or similar generic openers. No "delve into," "navigate the complexities," "unlock the power."

8. USE ACTIVE VOICE: "The team achieved results" not "Results were achieved by the team." Be direct and energetic.

9. INCLUDE COUNTERPOINTS: Address objections and present balanced views. Acknowledge "on the other hand" and "critics argue."

10. NATURAL KEYWORD INTEGRATION: Place keywords where they flow naturally. Never force or stuff keywords. Use synonyms and related terms.

11. WRITE LIKE YOU SPEAK: Read each paragraph aloud. If it sounds stilted or robotic, rewrite it. Aim for a natural speaking rhythm.

12. USE DATA AND STATISTICS: Cite specific numbers, percentages, and findings. "According to a 2024 study by..." adds authority.

13. CREATE MENTAL IMAGES: Use vivid, sensory language. Paint pictures with words. Make abstract concepts tangible.

14. VARY VOCABULARY: Don't repeat the same adjectives or transition words. Use a thesaurus-minded approach without being pretentious.

15. END WITH IMPACT: Each section should have a strong closing sentence. The conclusion should leave the reader with a memorable takeaway or call to action.

CRITICAL: Your output must be valid JSON matching the requested schema exactly. Do not include any text outside the JSON object. The JSON must be parseable by JSON.parse() without errors.`;
  }

  // ─────────────────────────────────────────────────────────────
  // 7. humanizeContent
  // ─────────────────────────────────────────────────────────────

  /**
   * Rewrite content with higher temperature (0.9) to make it
   * more natural and less detectable as AI-generated.
   * Adds transitional phrases and varies sentence structure.
   */
  async humanizeContent(content: string): Promise<string> {
    this.logger.log('Humanizing content...');

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.deepseek.generateContent(
          `Rewrite the following content to sound more natural and human-written. Follow these rules:
1. Vary sentence length and structure
2. Add transitional phrases like "here's the thing," "what's interesting is," "that said," "the truth is"
3. Use contractions (don't, can't, it's, there's)
4. Break long sentences into shorter ones
5. Add occasional rhetorical questions or conversational asides
6. Use active voice throughout
7. Inject personality and opinion where appropriate
8. Remove any robotic or AI-sounding phrases
9. Keep all factual information intact
10. Maintain the same general length and structure

Return ONLY the rewritten content, no explanations or meta-text.

CONTENT TO REWRITE:
${content.substring(0, 12000)}`,
          {
            model: 'deepseek-reasoner',
            temperature: 0.9,
            maxTokens: 8192,
            systemPrompt:
              'You are a human writing coach and editor. Your specialty is making AI-generated text ' +
              'read as if a knowledgeable human wrote it. You preserve all facts, data, and key messages ' +
              'while transforming the voice, rhythm, and personality to be indistinguishable from ' +
              'expert human writing. Never include meta-commentary like "I have rewritten..." — just ' +
              'output the revised content directly.',
          },
        );

        const humanized = response.content.trim();

        if (humanized.length < 50) {
          throw new BadRequestException('Humanized content is too short');
        }

        return humanized;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Humanization attempt ${attempt + 1}/${maxRetries} failed: ${lastError.message}`,
        );
        if (attempt < maxRetries - 1) {
          await this.delay(1000 * (attempt + 1));
        }
      }
    }

    // Return original content if all attempts fail
    this.logger.warn('All humanization attempts failed, returning original content');
    return content;
  }

  // ─────────────────────────────────────────────────────────────
  // 8. humanizeArticle
  // ─────────────────────────────────────────────────────────────

  /**
   * Load an article by ID, run humanizeContent on it, and save
   * the result with a new version.
   */
  async humanizeArticle(id: string): Promise<any> {
    this.logger.log(`Humanizing article ${id}`);

    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) {
      throw new NotFoundException(`Article ${id} not found`);
    }

    const contentToHumanize = article.content || '';
    if (!contentToHumanize) {
      throw new BadRequestException(`Article ${id} has no content to humanize`);
    }

    this.emitProgress('humanizeContent', 50, 'Humanizing article content...', id);

    const humanized = await this.humanizeContent(contentToHumanize);

    // Get current version number
    const latestVersion = await this.prisma.articleVersion.findFirst({
      where: { articleId: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latestVersion?.version || 0) + 1;

    // Create version before updating
    await this.prisma.articleVersion.create({
      data: {
        articleId: id,
        version: nextVersion,
        content: article.content || '',
        metadata: {
          action: 'humanize',
          previousAiDetectionScore: article.aiDetectionScore,
          timestamp: new Date().toISOString(),
        },
        reason: 'AI detection humanization',
      },
    });

    const updated = await this.prisma.article.update({
      where: { id },
      data: {
        content: humanized,
        wordCount: this.countWords(humanized),
        readingTime: this.estimateReadingTime(humanized, (article.images || []).length),
        aiDetectionScore: Math.max(0, (article.aiDetectionScore || 0) - 0.15),
        updatedAt: new Date(),
      },
    });

    this.emitProgress('complete', 100, 'Article humanized successfully!', id);
    this.logger.log(`Article ${id} humanized and updated (version ${nextVersion})`);

    return updated;
  }

  // ─────────────────────────────────────────────────────────────
  // 9. regenerateArticle
  // ─────────────────────────────────────────────────────────────

  /**
   * Load an existing article and regenerate specified parts.
   * Can selectively regenerate metadata, content, and/or images.
   */
  async regenerateArticle(
    id: string,
    options?: RegenerateOptions,
  ): Promise<any> {
    this.logger.log(`Regenerating article ${id}`);

    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) {
      throw new NotFoundException(`Article ${id} not found`);
    }

    const opts = {
      preserveImages: true,
      regenerateMetadata: false,
      regenerateContent: true,
      regenerateImages: false,
      ...options,
    };

    const keywords: string[] = [];
    if (article.keywords) {
      if (Array.isArray(article.keywords)) {
        keywords.push(...article.keywords);
      } else if (typeof article.keywords === 'string') {
        try {
          const parsed = JSON.parse(article.keywords as string);
          if (Array.isArray(parsed)) keywords.push(...parsed);
        } catch {
          keywords.push(article.keywords as string);
        }
      }
    }

    const genOptions: GenerateArticleOptions = {
      wordCount: article.wordCount || 1500,
      tone: opts.tone || article.tone || 'professional',
      style: opts.style || article.style || 'guide',
      audience: article.audience || 'general',
      primaryKeywords: keywords.length ? keywords : undefined,
      generateImages: opts.regenerateImages && !opts.preserveImages,
      projectId: article.projectId || undefined,
    };

    let metadata: ArticleMetadata;
    if (opts.regenerateMetadata) {
      this.emitProgress('regenerateMetadata', 20, 'Regenerating metadata...', id);
      metadata = await this.generateMetadata(
        article.title,
        article.metaDescription || article.title,
        keywords,
      );
    } else {
      metadata = {
        metaTitle: article.metaTitle || article.title,
        metaDescription: article.metaDescription || '',
        slug: article.slug,
        ogTitle: article.ogTitle || article.metaTitle || article.title,
        ogDescription: article.ogDescription || article.metaDescription || '',
        twitterTitle: article.metaTitle || article.title,
        twitterDescription: article.metaDescription || '',
      };
    }

    let content: GeneratedContent;
    if (opts.regenerateContent) {
      this.emitProgress('regenerateContent', 50, 'Regenerating content...', id);
      content = await this.generateContent(metadata, genOptions);
    } else {
      content = {
        introduction: article.introduction || '',
        sections: this.parseExistingSections(article.content || ''),
        conclusion: article.conclusion || '',
        faq: article.faq ? (article.faq as any[]) : undefined,
        cta: article.cta || undefined,
      };
    }

    let images: string[] = article.images || [];
    if (opts.regenerateImages) {
      this.emitProgress('regenerateImages', 75, 'Regenerating images...', id);
      try {
        const newImages = await this.generateImages(
          article.title,
          metadata.metaDescription || article.title,
          content,
          genOptions,
        );
        if (opts.preserveImages) {
          images = [...images, ...newImages];
        } else {
          images = newImages;
        }
      } catch (imgError) {
        this.logger.warn(`Image regeneration failed: ${(imgError as Error).message}`);
      }
    }

    this.emitProgress('saving', 90, 'Saving regenerated article...', id);

    // Save a version before updating
    const latestVersion = await this.prisma.articleVersion.findFirst({
      where: { articleId: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latestVersion?.version || 0) + 1;

    await this.prisma.articleVersion.create({
      data: {
        articleId: id,
        version: nextVersion,
        content: article.content || '',
        metadata: {
          action: 'regenerate',
          regenerateMetadata: opts.regenerateMetadata,
          regenerateContent: opts.regenerateContent,
          regenerateImages: opts.regenerateImages,
          timestamp: new Date().toISOString(),
        },
        reason: 'Article regeneration',
      },
    });

    const fullHtml = this.assembleContentHtml(content, metadata, images);
    const wordCount = this.countWords(fullHtml);

    const updated = await this.prisma.article.update({
      where: { id },
      data: {
        metaTitle: metadata.metaTitle,
        metaDescription: metadata.metaDescription,
        slug: metadata.slug,
        ogTitle: metadata.ogTitle,
        ogDescription: metadata.ogDescription,
        introduction: content.introduction,
        content: fullHtml,
        conclusion: content.conclusion,
        cta: content.cta || null,
        faq: content.faq || null,
        images,
        featuredImage: images[0] || article.featuredImage,
        wordCount,
        readingTime: this.estimateReadingTime(fullHtml, images.length),
        updatedAt: new Date(),
      },
    });

    this.emitProgress('complete', 100, 'Regeneration complete!', id);
    this.logger.log(`Article ${id} regenerated successfully (version ${nextVersion})`);

    return updated;
  }

  // ─────────────────────────────────────────────────────────────
  // 10. countWords
  // ─────────────────────────────────────────────────────────────

  /**
   * Accurate word counter that strips HTML tags and counts
   * whitespace-delimited tokens.
   */
  countWords(text: string): number {
    if (!text || typeof text !== 'string') return 0;

    const cleaned = text
      // Remove HTML tags
      .replace(/<[^>]*>/g, ' ')
      // Remove markdown image syntax
      .replace(/!\[.*?\]\(.*?\)/g, '')
      // Remove markdown link syntax
      .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
      // Remove URLs
      .replace(/https?:\/\/\S+/g, '')
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, '')
      // Remove inline code
      .replace(/`[^`]+`/g, '')
      // Remove extra whitespace
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return 0;

    const words = cleaned.split(/\s+/);
    return words.length;
  }

  // ─────────────────────────────────────────────────────────────
  // 11. estimateReadingTime
  // ─────────────────────────────────────────────────────────────

  /**
   * Estimate reading time in minutes.
   * Formula: (words / 200) + 1 minute per image.
   */
  estimateReadingTime(text: string, imageCount: number = 0): number {
    if (!text) return 0;

    const wordCount = this.countWords(text);
    const readingMinutes = Math.ceil(wordCount / 200);
    const imageMinutes = imageCount; // 1 minute per image

    return readingMinutes + imageMinutes;
  }

  // ─────────────────────────────────────────────────────────────
  // 12. emitProgress
  // ─────────────────────────────────────────────────────────────

  /**
   * Emit a progress event via EventEmitter2.
   */
  emitProgress(
    step: string,
    progress: number,
    message?: string,
    articleId?: string,
  ): void {
    const event: ProgressEvent = {
      step,
      progress,
      message,
      articleId,
    };

    this.eventEmitter.emit('article.progress', event);
    this.logger.debug(`Progress: [${step}] ${progress}%${message ? ` - ${message}` : ''}`);
  }

  // ─────────────────────────────────────────────────────────────
  // 13. findAll - Paginated list with filters
  // ─────────────────────────────────────────────────────────────

  /**
   * Get a paginated list of articles with optional filters.
   * Supports search, status, project, and sorting.
   */
  async findAll(
    filter: ArticleFilter,
  ): Promise<{ data: any[]; total: number; page: number; limit: number; totalPages: number }> {
    const { page, limit, status, search, projectId, sortBy, sortOrder } = filter;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
    };

    if (status) {
      where.status = status;
    }

    if (projectId) {
      where.projectId = projectId;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { metaDescription: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    let orderBy: any = { createdAt: 'desc' };
    if (sortBy) {
      const allowedSortFields = [
        'createdAt', 'updatedAt', 'title', 'wordCount',
        'readingTime', 'seoScore', 'status', 'publishedAt',
      ];
      if (allowedSortFields.includes(sortBy)) {
        orderBy = { [sortBy]: sortOrder || 'desc' };
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          slug: true,
          metaTitle: true,
          metaDescription: true,
          status: true,
          wordCount: true,
          readingTime: true,
          featuredImage: true,
          keywords: true,
          tags: true,
          tone: true,
          style: true,
          audience: true,
          version: true,
          seoScore: true,
          aiDetectionScore: true,
          projectId: true,
          createdAt: true,
          updatedAt: true,
          publishedAt: true,
        },
      }),
      this.prisma.article.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 14. findById
  // ─────────────────────────────────────────────────────────────

  /**
   * Get a single article by ID with full content.
   */
  async findById(id: string): Promise<any> {
    const article = await this.prisma.article.findUnique({
      where: { id },
      include: {
        articleVersions: {
          orderBy: { version: 'desc' },
          take: 5,
          select: {
            version: true,
            reason: true,
            createdAt: true,
          },
        },
        seoAudits: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        images: {
          select: {
            id: true,
            url: true,
            altText: true,
            prompt: true,
          },
        },
      },
    });

    if (!article) {
      throw new NotFoundException(`Article ${id} not found`);
    }

    return article;
  }

  // ─────────────────────────────────────────────────────────────
  // 15. updateArticle
  // ─────────────────────────────────────────────────────────────

  /**
   * Update an article and create a version snapshot before updating.
   */
  async updateArticle(id: string, dto: UpdateArticleDto): Promise<any> {
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) {
      throw new NotFoundException(`Article ${id} not found`);
    }

    // Get current version number
    const latestVersion = await this.prisma.articleVersion.findFirst({
      where: { articleId: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latestVersion?.version || 0) + 1;

    // Save version snapshot
    await this.prisma.articleVersion.create({
      data: {
        articleId: id,
        version: nextVersion,
        content: article.content || '',
        metadata: {
          action: 'update',
          changes: Object.keys(dto),
          timestamp: new Date().toISOString(),
        },
        reason: 'Article update via API',
      },
    });

    // Build update data
    const updateData: any = { ...dto };

    // Recalculate word count and reading time if content changed
    if (dto.content) {
      updateData.wordCount = this.countWords(dto.content);
      updateData.readingTime = this.estimateReadingTime(
        dto.content,
        Array.isArray(article.images) ? article.images.length : 0,
      );
    }

    if (dto.published === true) {
      updateData.publishedAt = new Date();
      updateData.status = 'PUBLISHED';
    }

    updateData.updatedAt = new Date();

    const updated = await this.prisma.article.update({
      where: { id },
      data: updateData,
    });

    this.logger.log(`Article ${id} updated (version ${nextVersion})`);

    return updated;
  }

  // ─────────────────────────────────────────────────────────────
  // 16. deleteArticle
  // ─────────────────────────────────────────────────────────────

  /**
   * Delete an article. Performs a soft delete (marks as DELETED status)
   * by default, but removes from the database if hardDelete is true.
   */
  async deleteArticle(id: string, hardDelete: boolean = false): Promise<void> {
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) {
      throw new NotFoundException(`Article ${id} not found`);
    }

    if (hardDelete) {
      // Hard delete — remove from database
      await this.prisma.article.delete({ where: { id } });
      this.logger.log(`Article ${id} permanently deleted`);
    } else {
      // Soft delete — mark as deleted
      await this.prisma.article.update({
        where: { id },
        data: {
          status: 'DELETED' as any,
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      this.logger.log(`Article ${id} soft-deleted`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 17. publishArticle
  // ─────────────────────────────────────────────────────────────

  /**
   * Mark an article as published.
   * Sets status to PUBLISHED and records the published timestamp.
   */
  async publishArticle(id: string): Promise<any> {
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) {
      throw new NotFoundException(`Article ${id} not found`);
    }

    const now = new Date();

    const updated = await this.prisma.article.update({
      where: { id },
      data: {
        status: 'PUBLISHED' as any,
        publishedAt: now,
        updatedAt: now,
      },
    });

    this.logger.log(`Article ${id} published`);

    // Emit publish event
    this.eventEmitter.emit('article.published', {
      articleId: id,
      title: article.title,
      slug: article.slug,
      publishedAt: now,
    });

    return updated;
  }

  // ─────────────────────────────────────────────────────────────
  // 18. optimizeSEO
  // ─────────────────────────────────────────────────────────────

  /**
   * Run SEO optimization on an article.
   * Updates the article with optimized content and creates a version.
   */
  async optimizeSEO(id: string): Promise<any> {
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) {
      throw new NotFoundException(`Article ${id} not found`);
    }

    const content = article.content || '';
    const title = article.metaTitle || article.title;
    const keywords: string[] = [];

    if (article.keywords) {
      if (Array.isArray(article.keywords)) {
        keywords.push(...article.keywords);
      } else if (typeof article.keywords === 'string') {
        try {
          const parsed = JSON.parse(article.keywords as string);
          if (Array.isArray(parsed)) keywords.push(...parsed);
        } catch {
          keywords.push(article.keywords as string);
        }
      }
    }

    const primaryKeyword = keywords[0] || title;

    this.emitProgress('seoOptimize', 30, 'Running SEO optimization...', id);

    // Run SEO optimization
    const seoResult = await this.seoOptimizer.optimize(content, primaryKeyword, {
      title,
      metaDescription: article.metaDescription || '',
    });

    this.emitProgress('seoOptimize', 60, 'Running SEO audit...', id);

    // Run SEO audit
    const audit = await this.seoOptimizer.audit(id);

    this.emitProgress('seoOptimize', 80, 'Generating schema markup...', id);

    // Generate schema markup
    let schema: any = null;
    try {
      schema = await this.seoOptimizer.generateSchema(id);
    } catch (schemaError) {
      this.logger.warn(`Schema generation failed: ${(schemaError as Error).message}`);
    }

    // Generate meta tags
    const metaTags = await this.seoOptimizer.generateMetaTags(
      title,
      content,
      primaryKeyword,
    );

    // Save a version before updating
    const latestVersion = await this.prisma.articleVersion.findFirst({
      where: { articleId: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latestVersion?.version || 0) + 1;

    await this.prisma.articleVersion.create({
      data: {
        articleId: id,
        version: nextVersion,
        content: content,
        metadata: {
          action: 'seo_optimize',
          seoScore: seoResult?.estimatedScore,
          auditScore: audit?.overallScore,
          timestamp: new Date().toISOString(),
        },
        reason: 'SEO optimization',
      },
    });

    // Create SEO audit record
    await this.prisma.seoAudit.create({
      data: {
        articleId: id,
        score: audit?.overallScore || seoResult?.estimatedScore || null,
        issues: audit?.checklist || null,
        optimizedContent: seoResult?.optimizedTitle || null,
        metaTags: metaTags || null,
        schemaMarkup: schema || null,
        keywordDensity: article.seo ? (article.seo as any).keywordDensity : null,
      },
    });

    // Update the article with SEO improvements
    const updateData: any = {
      seoScore: audit?.overallScore || seoResult?.estimatedScore || null,
      updatedAt: new Date(),
    };

    if (metaTags?.metaTitle) updateData.metaTitle = metaTags.metaTitle;
    if (metaTags?.metaDescription) updateData.metaDescription = metaTags.metaDescription;
    if (metaTags?.ogTitle) updateData.ogTitle = metaTags.ogTitle;
    if (metaTags?.ogDescription) updateData.ogDescription = metaTags.ogDescription;

    const updated = await this.prisma.article.update({
      where: { id },
      data: updateData,
    });

    this.emitProgress('complete', 100, 'SEO optimization complete!', id);
    this.logger.log(`SEO optimization completed for article ${id} (score: ${audit?.overallScore || 'N/A'})`);

    return {
      article: updated,
      audit,
      seoResult,
      schema,
      metaTags,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Generate images for the article using ImageGeneratorService.
   * Generates a featured image and section-specific images in parallel.
   */
  private async generateImages(
    title: string,
    topic: string,
    content: GeneratedContent,
    options: GenerateArticleOptions,
  ): Promise<string[]> {
    const imageUrls: string[] = [];
    const imagePromises: Promise<void>[] = [];

    // Generate a featured image
    const featurePrompt = `Featured image for article: ${title}. Topic: ${topic}. Style: Professional, high-quality blog imagery.`;

    imagePromises.push(
      (async () => {
        try {
          const result = await this.imageGenerator.generate({
            prompt: featurePrompt,
            options: {
              style: 'realistic',
              aspectRatio: '16:9',
            },
            projectId: options.projectId,
          } as any);
          if (result?.url) {
            imageUrls.push(result.url);
          }
        } catch (error) {
          this.logger.warn(`Featured image generation failed: ${(error as Error).message}`);
        }
      })(),
    );

    // Generate images for major sections (limit to 3 to avoid excessive API calls)
    const sectionPrompts = content.sections.slice(0, 3).map((section) => ({
      prompt: `Blog illustration for section: ${section.heading}. Topic: ${topic}. Style: Professional, clean, relevant to content marketing.`,
      heading: section.heading,
    }));

    for (const sectionPrompt of sectionPrompts) {
      imagePromises.push(
        (async () => {
          try {
            const result = await this.imageGenerator.generate({
              prompt: sectionPrompt.prompt,
              options: {
                style: 'realistic',
                aspectRatio: '16:9',
              },
              projectId: options.projectId,
            } as any);
            if (result?.url) {
              imageUrls.push(result.url);
            }
          } catch (error) {
            this.logger.warn(`Section image generation failed for "${sectionPrompt.heading}": ${(error as Error).message}`);
          }
        })(),
      );
    }

    await Promise.allSettled(imagePromises);

    return imageUrls;
  }

  /**
   * Run AI detection check on content.
   * Uses a heuristic/statistical approach to estimate AI-likeness.
   */
  private async aiDetectionCheck(text: string): Promise<number> {
    const sample = text.substring(0, 5000);
    let score = 0;

    // Heuristic 1: Burstiness (variance in sentence length)
    const sentences = sample.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    if (sentences.length > 3) {
      const lengths = sentences.map((s) => s.split(/\s+/).filter((w) => w.length > 0).length);
      const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const variance = lengths.reduce((sum, l) => sum + Math.pow(l - mean, 2), 0) / lengths.length;
      const stdDev = Math.sqrt(variance);
      // Low variance indicates AI-like uniformity
      const burstinessScore = Math.min(1, Math.max(0, 1 - stdDev / mean));
      score += burstinessScore * 0.25;
    }

    // Heuristic 2: Common AI phrase detection
    const aiPhrases = [
      'in today\'s digital landscape', 'in this article, we will',
      'it is important to note', 'it is worth noting',
      'when it comes to', 'in the world of',
      'the landscape of', 'navigate the complexities',
      'unlock the power', 'delve into',
      'the realm of', 'a plethora of',
      'in the ever-evolving', 'it is crucial to',
      'arguably the most', 'highly scalable',
      'cutting-edge', 'game-changer',
      'revolutionize', 'best-in-class',
      'state-of-the-art', 'as we move forward',
      'in conclusion, it is clear', 'to sum up,',
    ];
    const lowerSample = sample.toLowerCase();
    let phraseMatches = 0;
    for (const phrase of aiPhrases) {
      if (lowerSample.includes(phrase)) {
        phraseMatches++;
      }
    }
    const phraseScore = Math.min(1, phraseMatches / 5);
    score += phraseScore * 0.25;

    // Heuristic 3: Lexical diversity
    const words = sample.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (words.length > 20) {
      const uniqueWords = new Set(words);
      const diversity = uniqueWords.size / words.length;
      // Very high or very low diversity can indicate AI writing
      const diversityScore = diversity > 0.8 ? 1 - (diversity - 0.8) / 0.2 : Math.min(1, (0.5 - diversity) * 2);
      score += Math.max(0, Math.min(1, diversityScore)) * 0.2;
    }

    // Heuristic 4: Transitional phrase density
    const transitionPhrases = [
      'however', 'therefore', 'moreover', 'furthermore',
      'nevertheless', 'consequently', 'additionally', 'subsequently',
      'in addition', 'as a result', 'on the other hand',
      'in contrast', 'similarly', 'likewise', 'notably',
      'specifically', 'particularly', 'importantly',
    ];
    let transitionMatches = 0;
    for (const phrase of transitionPhrases) {
      const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
      const matches = lowerSample.match(regex);
      if (matches) transitionMatches += matches.length;
    }
    // Too many transitions can indicate AI writing
    const transitionDensity = transitionMatches / Math.max(1, words.length);
    const transitionScore = Math.min(1, transitionDensity * 20);
    score += transitionScore * 0.15;

    // Heuristic 5: Use API-based detection if available
    try {
      const cachedScore = await this.cacheManager.get<number>(`ai_detect:${this.hashString(sample.substring(0, 500))}`);
      if (cachedScore !== undefined && cachedScore !== null) {
        // Blend cached score with heuristic score
        score = score * 0.4 + cachedScore * 0.6;
      } else {
        // Try DeepSeek-based detection
        const detectionResult = await this.deepseek.generateContent(
          `Analyze the following text for AI-generated content. Rate it from 0 (definitely human-written) to 1 (definitely AI-generated). Consider: sentence variety, vocabulary range, natural flow, use of contractions, paragraph structure, and presence of AI-typical patterns.

Return ONLY a number between 0 and 1, nothing else.

TEXT:
${sample.substring(0, 2000)}`,
          {
            model: 'deepseek-v4-flash',
            temperature: 0.2,
            maxTokens: 50,
            systemPrompt: 'You are an AI content detection analyzer. Return only a single float between 0 and 1 indicating the probability this text is AI-generated. 0 = definitely human, 1 = definitely AI.',
          },
        );

        const apiScore = parseFloat(detectionResult.content.trim());
        if (!isNaN(apiScore) && apiScore >= 0 && apiScore <= 1) {
          await this.cacheManager.set(
            `ai_detect:${this.hashString(sample.substring(0, 500))}`,
            apiScore,
            3600_000, // 1 hour TTL
          );
          // Blend
          score = score * 0.3 + apiScore * 0.7;
        }
      }
    } catch {
      // API-based detection failed, use heuristic scores only
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Build the metadata generation prompt.
   */
  private buildMetadataPrompt(
    title: string,
    topic: string,
    keywordStr: string,
  ): string {
    return `Generate SEO metadata for a blog article.

Title: ${title}
Topic/Subject: ${topic}
Target Keywords: ${keywordStr}

Generate the following as JSON:
- metaTitle: SEO-optimized title tag (50-60 characters, include primary keyword)
- metaDescription: Compelling meta description (150-160 characters, include keyword + CTA)
- slug: URL-friendly slug (3-6 words, lowercase, hyphens)
- ogTitle: Open Graph title (40-50 characters, optimized for social sharing)
- ogDescription: Open Graph description (60-70 characters)
- twitterTitle: Twitter/X card title (40-50 characters)
- twitterDescription: Twitter/X card description (60-70 characters)`;
  }

  /**
   * Assemble content sections into a complete HTML article.
   */
  private assembleContentHtml(
    content: GeneratedContent,
    metadata: ArticleMetadata,
    images: string[],
  ): string {
    const parts: string[] = [];

    // Table of contents (if available)
    if (content.toc) {
      parts.push(`<nav class="toc">${content.toc}</nav>`);
    }

    // Introduction
    parts.push(`<div class="article-introduction">`);
    parts.push(`<p>${content.introduction}</p>`);
    parts.push(`</div>`);

    // Insert featured image after intro
    if (images.length > 0) {
      parts.push(
        `<figure class="featured-image">` +
        `<img src="${images[0]}" alt="${metadata.metaTitle || 'Article featured image'}" loading="lazy" />` +
        `</figure>`,
      );
    }

    // Sections
    content.sections.forEach((section, index) => {
      parts.push(`<section class="article-section">`);
      parts.push(`<h2>${section.heading}</h2>`);

      // Insert section image if available (skip for first section if we have a featured image)
      if (index > 0 && images.length > index) {
        parts.push(
          `<figure class="section-image">` +
          `<img src="${images[index]}" alt="${section.heading}" loading="lazy" />` +
          `</figure>`,
        );
      }

      parts.push(`<div class="section-content">${section.content}</div>`);
      parts.push(`</section>`);
    });

    // FAQ section
    if (content.faq && content.faq.length > 0) {
      parts.push(`<section class="article-faq">`);
      parts.push(`<h2>Frequently Asked Questions</h2>`);
      content.faq.forEach((item) => {
        parts.push(
          `<div class="faq-item">` +
          `<h3>${item.question}</h3>` +
          `<p>${item.answer}</p>` +
          `</div>`,
        );
      });
      parts.push(`</section>`);
    }

    // Conclusion
    parts.push(`<div class="article-conclusion">`);
    parts.push(content.conclusion);
    parts.push(`</div>`);

    // CTA
    if (content.cta) {
      parts.push(`<div class="article-cta">`);
      parts.push(content.cta);
      parts.push(`</div>`);
    }

    return parts.join('\n');
  }

  /**
   * Extract plain text from HTML content.
   */
  private extractPlainText(html: string): string {
    if (!html) return '';
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Save a new article to the database.
   */
  private async saveArticle(data: {
    id: string;
    title: string;
    slug: string;
    metaTitle?: string | null;
    metaDescription?: string | null;
    ogTitle?: string | null;
    ogDescription?: string | null;
    twitterCard?: string | null;
    introduction: string;
    tableOfContents?: any;
    content: string;
    faq?: any;
    conclusion?: string | null;
    cta?: string | null;
    images: string[];
    featuredImage?: string | null;
    seoScore?: number | null;
    aiDetectionScore?: number | null;
    wordCount?: number | null;
    readingTime?: number | null;
    projectId?: string | null;
    status?: string;
    tone?: string;
    style?: string;
    audience?: string;
    keywords: string[];
  }): Promise<any> {
    // Create a unique slug if none provided
    let slug = data.slug;
    if (!slug || slug.length < 2) {
      slug = this.slugify(data.title);
    }

    // Ensure slug uniqueness
    const existingSlug = await this.prisma.article.findUnique({ where: { slug } });
    if (existingSlug) {
      slug = `${slug}-${this.generateShortId(6)}`;
    }

    const article = await this.prisma.article.create({
      data: {
        id: data.id,
        title: data.title,
        slug,
        metaTitle: data.metaTitle || null,
        metaDescription: data.metaDescription || null,
        ogTitle: data.ogTitle || null,
        ogDescription: data.ogDescription || null,
        twitterCard: data.twitterCard || null,
        introduction: data.introduction,
        tableOfContents: data.tableOfContents || null,
        content: data.content,
        faq: data.faq || null,
        conclusion: data.conclusion || null,
        cta: data.cta || null,
        images: data.images,
        featuredImage: data.featuredImage || null,
        seoScore: data.seoScore || null,
        aiDetectionScore: data.aiDetectionScore || null,
        wordCount: data.wordCount || null,
        readingTime: data.readingTime || null,
        projectId: data.projectId || null,
        status: (data.status || 'DRAFT') as any,
        keywords: data.keywords,
        tone: data.tone || null,
        style: data.style || null,
        audience: data.audience || null,
      },
    });

    // Create initial version
    await this.prisma.articleVersion.create({
      data: {
        articleId: article.id,
        version: 1,
        content: data.content,
        metadata: {
          action: 'create',
          generatedWith: 'deepseek-reasoner',
          timestamp: new Date().toISOString(),
        },
        reason: 'Initial article generation',
      },
    });

    return article;
  }

  /**
   * Parse existing sections from stored HTML content.
   * Extracts H2 headings and their following content.
   */
  private parseExistingSections(html: string): Array<{ heading: string; content: string }> {
    if (!html) return [];

    const sections: Array<{ heading: string; content: string }> = [];
    const h2Regex = /<h2[^>]*>(.*?)<\/h2>/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = h2Regex.exec(html)) !== null) {
      const heading = match[1].replace(/<[^>]*>/g, '').trim();
      const startIdx = match.index + match[0].length;
      const endIdx = h2Regex.lastIndex > 0 ? h2Regex.lastIndex : html.length;

      // Content between this H2 and the next H2 (or end)
      const nextMatch = h2Regex.exec(html);
      const contentEnd = nextMatch ? nextMatch.index : html.length;
      h2Regex.lastIndex = nextMatch ? nextMatch.index : html.length;

      const sectionContent = html.substring(startIdx, contentEnd).trim();
      sections.push({ heading, content: sectionContent });
    }

    return sections;
  }

  /**
   * Create an SSE MessageEvent.
   */
  private createMessageEvent(type: string, data: any): MessageEvent {
    return {
      type,
      data: typeof data === 'string' ? data : JSON.stringify(data),
    } as MessageEvent;
  }

  /**
   * Slugify a string for URL use.
   */
  private slugify(text: string): string {
    if (!text) return `article-${this.generateShortId(8)}`;

    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')  // Remove non-word chars
      .replace(/[\s_]+/g, '-')    // Replace spaces and underscores with hyphens
      .replace(/-+/g, '-')        // Collapse multiple hyphens
      .replace(/^-+|-+$/g, '')    // Trim hyphens from ends
      .substring(0, 80)           // Limit length
      || `article-${this.generateShortId(8)}`;
  }

  /**
   * Generate a short alphanumeric ID.
   */
  private generateShortId(length: number = 8): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Truncate text to a maximum length, preferring to break at word boundaries.
   */
  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) return text || '';

    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated;
  }

  /**
   * Hash a string for cache key generation.
   */
  private hashString(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Promise-based delay.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

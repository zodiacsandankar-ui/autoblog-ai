import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DeepSeekService } from '../../ai/providers/deepseek.service';

@Injectable()
export class SeoOptimizerService {
  private readonly logger = new Logger(SeoOptimizerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deepseek: DeepSeekService,
  ) {}

  async optimize(
    content: string,
    keyword: string,
    options?: Record<string, any>,
  ): Promise<any> {
    this.logger.log(`Optimizing content for keyword: ${keyword}`);

    try {
      const response = await this.deepseek.complete({
        model: 'deepseek-reasoner',
        messages: [
          {
            role: 'system',
            content: `You are an elite SEO content optimizer. Your task is to optimize content for search engines while maintaining readability and natural language flow.

Optimize the following aspects:
1. Title tag (55-60 characters, include primary keyword near beginning)
2. Meta description (150-160 characters, include keyword, include CTA)
3. URL slug (short, keyword-rich, 3-5 words)
4. Heading structure (proper H1-H6 hierarchy, keyword in H1)
5. Content optimization (keyword placement, LSI keywords, readability)
6. Internal linking suggestions
7. Image alt text optimization

Return ONLY valid JSON.`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              task: 'Optimize the following content for SEO',
              keyword,
              content: content.substring(0, 8000),
              options: options || {},
              instructions: `Provide:
1. optimizedTitle: SEO-optimized title (55-60 chars)
2. metaDescription: Compelling meta description (150-160 chars)
3. slug: URL-optimized slug
4. suggestedHeadings: Array of optimized H2 headings
5. keywordPlacements: Array of {suggestedPosition, context} objects
6. lsiKeywords: Array of 5-7 LSI keywords to include
7. contentSuggestions: Array of content improvement suggestions
8. estimatedScore: Estimated SEO score 0-100
9. improvements: Array of specific improvements made`,
              output_format: 'json',
            }),
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const optimization = JSON.parse(response.choices[0].message.content);
      return {
        keyword,
        originalLength: content.length,
        ...optimization,
        optimizedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`SEO optimization failed: ${error.message}`);
      throw new BadRequestException(`SEO optimization failed: ${error.message}`);
    }
  }

  async audit(articleId: string): Promise<any> {
    this.logger.log(`Auditing article ${articleId} for SEO`);

    const article = await this.prisma.article.findUnique({ where: { id: articleId } });
    if (!article) {
      throw new NotFoundException(`Article ${articleId} not found`);
    }

    const content = article.content || '';
    const title = article.title || '';
    const slug = article.slug || '';
    const metaDesc = article.metaDescription || '';
    const metaTitle = article.metaTitle || '';

    const checklist: Record<string, any> = {
      titleTag: {
        passed: title.length > 30 && title.length <= 60,
        score: title.length > 30 && title.length <= 60 ? 100 : title.length > 20 ? 60 : 30,
        message: title.length > 30 && title.length <= 60
          ? 'Title length is optimal'
          : title.length > 60 ? 'Title is too long (>60 chars)' : 'Title is too short (<30 chars)',
        value: title.length,
      },
      metaDescription: {
        passed: metaDesc.length >= 120 && metaDesc.length <= 160,
        score: metaDesc.length >= 120 && metaDesc.length <= 160 ? 100 : metaDesc.length > 80 ? 60 : 20,
        message: metaDesc.length >= 120 && metaDesc.length <= 160
          ? 'Meta description length is optimal'
          : metaDesc.length > 160 ? 'Meta description is too long' : 'Meta description is too short or missing',
        value: metaDesc.length,
      },
      slugStructure: {
        passed: slug.length > 0 && slug.length <= 60 && /^[a-z0-9-]+$/.test(slug),
        score: slug.length > 0 && slug.length <= 60 ? 100 : 40,
        message: slug.length > 0 && slug.length <= 60
          ? 'Slug is well-structured'
          : 'Slug is missing or poorly structured',
        value: slug,
      },
      contentLength: {
        passed: content.length >= 1000,
        score: content.length >= 2000 ? 100 : content.length >= 1000 ? 70 : content.length >= 500 ? 40 : 10,
        message: content.length >= 1000
          ? 'Content length is adequate'
          : 'Content is too short for good SEO',
        value: content.length,
      },
      headingStructure: {
        passed: this.hasProperHeadings(content),
        score: this.hasProperHeadings(content) ? 90 : 30,
        message: this.hasProperHeadings(content)
          ? 'Heading structure is good'
          : 'Missing or improper heading structure',
        value: this.countHeadings(content),
      },
      keywordPresence: {
        passed: this.keywordInFirstParagraph(content, title),
        score: this.keywordInFirstParagraph(content, title) ? 100 : 50,
        message: 'Keyword should appear in title and first paragraph',
        value: true,
      },
      imageAltText: {
        passed: this.hasImageAltText(content),
        score: this.hasImageAltText(content) ? 90 : 40,
        message: this.hasImageAltText(content)
          ? 'Images have alt text'
          : 'Missing alt text on images',
        value: this.countImagesWithAlt(content),
      },
      internalLinks: {
        passed: this.hasInternalLinks(content),
        score: this.hasInternalLinks(content) ? 80 : 30,
        message: this.hasInternalLinks(content)
          ? 'Contains internal links'
          : 'No internal links found',
        value: this.countInternalLinks(content),
      },
      externalLinks: {
        passed: this.hasExternalLinks(content),
        score: this.hasExternalLinks(content) ? 80 : 50,
        message: 'Consider adding authoritative external links',
        value: this.countExternalLinks(content),
      },
      readability: {
        passed: this.calculateRawReadability(content) > 50,
        score: this.calculateRawReadability(content),
        message: `Readability score: ${this.calculateRawReadability(content).toFixed(0)}/100`,
        value: this.calculateRawReadability(content),
      },
      paragraphLength: {
        passed: this.averageParagraphLength(content) < 150,
        score: this.averageParagraphLength(content) < 100 ? 100 : this.averageParagraphLength(content) < 150 ? 75 : 40,
        message: `Average paragraph length: ${this.averageParagraphLength(content).toFixed(0)} words`,
        value: this.averageParagraphLength(content),
      },
      keywordDensity: {
        passed: this.calculateKeywordDensity(content, title) >= 0.5 && this.calculateKeywordDensity(content, title) <= 3,
        score: this.calculateKeywordDensity(content, title) >= 0.5 && this.calculateKeywordDensity(content, title) <= 2.5 ? 100 : 50,
        message: `Keyword density: ${this.calculateKeywordDensity(content, title).toFixed(2)}%`,
        value: this.calculateKeywordDensity(content, title),
      },
      metaTitleMatch: {
        passed: metaTitle ? metaTitle.length > 0 : false,
        score: metaTitle ? 100 : 0,
        message: metaTitle ? 'Meta title is set' : 'Meta title is missing',
        value: !!metaTitle,
      },
      openGraphTags: {
        passed: this.hasOpenGraphTags(article),
        score: this.hasOpenGraphTags(article) ? 100 : 30,
        message: this.hasOpenGraphTags(article) ? 'OG tags present' : 'OG tags missing',
        value: this.hasOpenGraphTags(article),
      },
      twitterCards: {
        passed: this.hasTwitterCards(article),
        score: this.hasTwitterCards(article) ? 100 : 30,
        message: this.hasTwitterCards(article) ? 'Twitter card tags present' : 'Twitter card tags missing',
        value: this.hasTwitterCards(article),
      },
      canonicalUrl: {
        passed: !!article.canonical_url,
        score: article.canonical_url ? 100 : 50,
        message: article.canonical_url ? 'Canonical URL is set' : 'Canonical URL is missing',
        value: !!article.canonical_url,
      },
      schemaMarkup: {
        passed: !!(article.seo as any)?.schema,
        score: (article.seo as any)?.schema ? 100 : 20,
        message: (article.seo as any)?.schema ? 'Schema markup present' : 'No schema markup found',
        value: !!(article.seo as any)?.schema,
      },
      wordCount: {
        passed: this.countWords(content) >= 300,
        score: this.countWords(content) >= 1000 ? 100 : this.countWords(content) >= 500 ? 70 : this.countWords(content) >= 300 ? 50 : 20,
        message: `Word count: ${this.countWords(content)}`,
        value: this.countWords(content),
      },
      mobileFriendly: {
        passed: true,
        score: 80,
        message: 'Assuming responsive design (check manually)',
        value: true,
      },
      loadingSpeed: {
        passed: true,
        score: 70,
        message: 'Performance score estimated (run Lighthouse for accurate data)',
        value: true,
      },
    };

    const totalScore = Object.values(checklist).reduce((sum: number, item: any) => sum + (item.score || 0), 0) / Object.keys(checklist).length;
    const passedCount = Object.values(checklist).filter((item: any) => item.passed).length;
    const totalCount = Object.keys(checklist).length;

    return {
      articleId,
      articleTitle: article.title,
      overallScore: Math.round(totalScore),
      passedChecks: passedCount,
      totalChecks: totalCount,
      scoreGrade: this.getScoreGrade(totalScore),
      checklist,
      recommendations: this.generateRecommendations(checklist),
      auditedAt: new Date(),
    };
  }

  async generateSchema(articleId: string): Promise<any> {
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
    });
    if (!article) throw new NotFoundException(`Article ${articleId} not found`);

    const schema: Record<string, any> = {
      '@context': 'https://schema.org',
      '@graph': [],
    };

    // Article schema
    const articleSchema = {
      '@type': 'Article',
      '@id': `${process.env.SITE_URL || 'https://autoblog.ai'}/${article.slug || article.id}`,
      headline: article.metaTitle || article.title,
      description: article.metaDescription || article.excerpt || '',
      datePublished: article.createdAt?.toISOString(),
      dateModified: article.updatedAt?.toISOString(),
      author: {
        '@type': 'Organization',
        name: 'AutoBlog AI',
      },
      publisher: {
        '@type': 'Organization',
        name: 'AutoBlog AI',
      },
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': `${process.env.SITE_URL || 'https://autoblog.ai'}/${article.slug || article.id}`,
      },
      image: article.featuredImage || undefined,
      keywords: Array.isArray(article.keywords) ? article.keywords.join(', ') : '',
      wordCount: this.countWords(article.content || ''),
    };
    schema['@graph'].push(articleSchema);

    // FAQ schema if applicable
    const faqSchema = this.extractFAQSchema(article.content || '');
    if (faqSchema) {
      schema['@graph'].push(faqSchema);
    }

    // Breadcrumb schema
    const breadcrumbSchema = {
      '@type': 'BreadcrumbList',
      '@id': `${process.env.SITE_URL || 'https://autoblog.ai'}/breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: process.env.SITE_URL || 'https://autoblog.ai' },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${process.env.SITE_URL || 'https://autoblog.ai'}/blog` },
        { '@type': 'ListItem', position: 3, name: article.title, item: `${process.env.SITE_URL || 'https://autoblog.ai'}/${article.slug || article.id}` },
      ],
    };
    schema['@graph'].push(breadcrumbSchema);

    await this.prisma.article.update({
      where: { id: articleId },
      data: {
        seo: {
          ...((article.seo as Record<string, any>) || {}),
          schema,
        } as any,
      },
    });

    return schema;
  }

  async generateMetaTags(title: string, content: string, keyword: string): Promise<any> {
    try {
      const response = await this.deepseek.complete({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'Generate optimized meta tags for SEO. Return ONLY valid JSON.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              task: 'Generate SEO meta tags',
              title,
              keyword,
              content: content.substring(0, 2000),
              output_format: {
                metaTitle: 'string (55-60 characters, include keyword)',
                metaDescription: 'string (150-160 characters, include keyword and CTA)',
                ogTitle: 'string (40-50 characters for social sharing)',
                ogDescription: 'string (60-70 characters for social sharing)',
                ogImage: 'string (suggested image description or URL)',
                twitterTitle: 'string (40-50 characters)',
                twitterDescription: 'string (60-70 characters)',
                focusKeyword: 'string',
                tags: 'string[] (3-5 relevant tags)',
              },
            }),
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      this.logger.warn(`Meta tag generation failed: ${error.message}, using defaults`);
      return {
        metaTitle: title.substring(0, 60),
        metaDescription: content.substring(0, 160).replace(/<[^>]*>/g, ''),
        ogTitle: title.substring(0, 50),
        ogDescription: content.substring(0, 70).replace(/<[^>]*>/g, ''),
        twitterTitle: title.substring(0, 50),
        twitterDescription: content.substring(0, 70).replace(/<[^>]*>/g, ''),
        focusKeyword: keyword,
        tags: [keyword],
      };
    }
  }

  async generateSitemap(projectId: string): Promise<string> {
    const articles = await this.prisma.article.findMany({
      where: { projectId, status: { not: 'draft' } },
      select: { slug: true, updatedAt: true, title: true },
      orderBy: { updatedAt: 'desc' },
    });

    const siteUrl = process.env.SITE_URL || 'https://autoblog.ai';
    const urls = articles.map(
      (article) => `
  <url>
    <loc>${siteUrl}/${article.slug || ''}</loc>
    <lastmod>${article.updatedAt?.toISOString() || new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`,
    ).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
  <url>
    <loc>${siteUrl}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${siteUrl}/blog</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>${urls}
</urlset>`;
  }

  async analyzeKeywordDensity(content: string, keyword: string): Promise<any> {
    const stripped = content.replace(/<[^>]*>/g, '');
    const words = stripped.toLowerCase().split(/[\s\n]+/).filter((w) => w.length > 0);
    const totalWords = words.length;

    const keywordLower = keyword.toLowerCase();
    const keywordWords = keywordLower.split(/\s+/);
    let exactCount = 0;
    let partialCount = 0;

    for (let i = 0; i < words.length; i++) {
      if (words[i] === keywordLower) {
        exactCount++;
      }
      if (words[i].includes(keywordLower)) {
        partialCount++;
      }
      // Check multi-word keyword
      if (keywordWords.length > 1) {
        const phrase = words.slice(i, i + keywordWords.length).join(' ');
        if (phrase === keywordLower) {
          exactCount++;
        }
      }
    }

    const density = (exactCount / totalWords) * 100;
    return {
      keyword,
      totalWords,
      exactMatches: exactCount,
      partialMatches: partialCount,
      density: parseFloat(density.toFixed(2)),
      densityGrade: density < 0.5 ? 'too-low' : density <= 3 ? 'optimal' : density <= 5 ? 'high' : 'too-high',
      recommendations: density < 0.5
        ? ['Increase keyword usage to at least 0.5% density', 'Add keyword to H1, first paragraph, and conclusion']
        : density > 3
        ? ['Reduce keyword density to avoid keyword stuffing', 'Use synonyms and LSI keywords instead']
        : ['Keyword density is within optimal range (0.5-3%)'],
    };
  }

  async calculateReadabilityScore(content: string): Promise<any> {
    const stripped = content.replace(/<[^>]*>/g, '');
    const sentences = stripped.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const words = stripped.split(/[\s\n]+/).filter((w) => w.length > 0);
    const syllables = this.countSyllables(stripped);

    const totalSentences = sentences.length || 1;
    const totalWords = words.length || 1;
    const totalSyllables = syllables || totalWords;

    // Flesch Reading Ease
    const fleschScore = 206.835 - 1.015 * (totalWords / totalSentences) - 84.6 * (totalSyllables / totalWords);

    // Flesch-Kincaid Grade Level
    const fkGrade = 0.39 * (totalWords / totalSentences) + 11.8 * (totalSyllables / totalWords) - 15.59;

    return {
      fleschReadingEase: parseFloat(fleschScore.toFixed(2)),
      fleschKincaidGrade: parseFloat(Math.max(0, fkGrade).toFixed(2)),
      totalSentences,
      totalWords,
      totalSyllables,
      averageWordsPerSentence: parseFloat((totalWords / totalSentences).toFixed(1)),
      averageSyllablesPerWord: parseFloat((totalSyllables / totalWords).toFixed(2)),
      readingEaseGrade: fleschScore >= 90 ? 'very-easy' : fleschScore >= 80 ? 'easy' : fleschScore >= 70 ? 'fairly-easy' : fleschScore >= 60 ? 'standard' : fleschScore >= 50 ? 'fairly-difficult' : fleschScore >= 30 ? 'difficult' : 'very-difficult',
      gradeLevel: fkGrade <= 6 ? 'elementary' : fkGrade <= 9 ? 'middle-school' : fkGrade <= 12 ? 'high-school' : fkGrade <= 15 ? 'college' : 'graduate',
    };
  }

  async suggestInternalLinks(articleId: string, projectId: string): Promise<any[]> {
    const article = await this.prisma.article.findUnique({ where: { id: articleId } });
    if (!article) throw new NotFoundException(`Article ${articleId} not found`);

    const otherArticles = await this.prisma.article.findMany({
      where: {
        projectId,
        id: { not: articleId },
        status: { not: 'draft' },
      },
      select: { id: true, title: true, slug: true, keywords: true, excerpt: true },
      take: 50,
    });

    const articleWords = (article.content || '').toLowerCase();
    const suggestions = otherArticles
      .map((other) => {
        const titleWords = other.title.toLowerCase().split(/\s+/);
        const keywordMatch = Array.isArray(other.keywords)
          ? other.keywords.filter((kw) => articleWords.includes(kw.toLowerCase())).length
          : 0;
        const titleMatch = titleWords.filter((w) => articleWords.includes(w)).length;
        const relevanceScore = (keywordMatch * 3 + titleMatch) / Math.max(titleWords.length, 1);

        return {
          suggestedUrl: `/blog/${other.slug || other.id}`,
          articleTitle: other.title,
          relevanceScore: parseFloat((relevanceScore * 100).toFixed(1)),
          matchReason: keywordMatch > 0
            ? `Shares ${keywordMatch} related keyword${keywordMatch > 1 ? 's' : ''}`
            : titleMatch > 0
            ? `Topically related through title similarity`
            : 'Consider if contextually relevant',
          articleId: other.id,
        };
      })
      .filter((s) => s.relevanceScore > 5)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 10);

    return suggestions;
  }

  // Private helpers
  private hasProperHeadings(content: string): boolean {
    const h1Count = (content.match(/<h1[\s>]/gi) || []).length;
    const h2Count = (content.match(/<h2[\s>]/gi) || []).length;
    return h1Count >= 1 && h2Count >= 1;
  }

  private countHeadings(content: string): number {
    return (content.match(/<h[1-6][\s>]/gi) || []).length;
  }

  private keywordInFirstParagraph(content: string, title: string): boolean {
    const firstPara = content.split(/<\/p>/i)[0]?.replace(/<[^>]*>/g, '') || '';
    const titleWords = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    return titleWords.some((w) => firstPara.toLowerCase().includes(w));
  }

  private hasImageAltText(content: string): boolean {
    const images = content.match(/<img[^>]+>/gi) || [];
    return images.some((img) => /alt\s*=\s*["'][^"']+["']/i.test(img));
  }

  private countImagesWithAlt(content: string): number {
    const images = content.match(/<img[^>]+>/gi) || [];
    return images.filter((img) => /alt\s*=\s*["'][^"']+["']/i.test(img)).length;
  }

  private hasInternalLinks(content: string): boolean {
    const baseUrl = process.env.SITE_URL || '';
    if (!baseUrl) return true;
    const links = content.match(/<a[^>]+href=["']([^"']+)["']/gi) || [];
    return links.some((link) => link.includes(baseUrl));
  }

  private countInternalLinks(content: string): number {
    const links = content.match(/<a[^>]+href=["']([^"']+)["']/gi) || [];
    return links.length;
  }

  private hasExternalLinks(content: string): boolean {
    const links = content.match(/<a[^>]+href=["']https?:\/\/([^"']+)["']/gi) || [];
    return links.length > 0;
  }

  private countExternalLinks(content: string): number {
    const links = content.match(/<a[^>]+href=["']https?:\/\/([^"']+)["']/gi) || [];
    return links.length;
  }

  private calculateRawReadability(content: string): number {
    const stripped = content.replace(/<[^>]*>/g, '');
    const words = stripped.split(/[\s\n]+/).filter((w) => w.length > 0).length || 1;
    const sentences = stripped.split(/[.!?]+/).filter((s) => s.trim().length > 0).length || 1;
    const avgWordsPerSentence = words / sentences;
    const score = Math.max(0, 100 - (Math.max(0, avgWordsPerSentence - 15) * 3));
    return Math.min(100, score);
  }

  private averageParagraphLength(content: string): number {
    const stripped = content.replace(/<[^>]*>/g, '');
    const paragraphs = stripped.split(/\n\n+/).filter((p) => p.trim().length > 0);
    if (paragraphs.length === 0) return 0;
    const totalWords = paragraphs.reduce((sum, p) => sum + p.split(/\s+/).filter((w) => w.length > 0).length, 0);
    return totalWords / paragraphs.length;
  }

  private calculateKeywordDensity(content: string, title: string): number {
    const stripped = content.replace(/<[^>]*>/g, '').toLowerCase();
    const words = stripped.split(/[\s\n]+/).filter((w) => w.length > 0);
    const titleWords = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (titleWords.length === 0 || words.length === 0) return 0;
    const matches = titleWords.filter((w) => words.includes(w)).length;
    return (matches / words.length) * 100;
  }

  private hasOpenGraphTags(article: any): boolean {
    const seo = article.seo as Record<string, any>;
    return !!(seo?.ogTitle || article.metaTitle);
  }

  private hasTwitterCards(article: any): boolean {
    const seo = article.seo as Record<string, any>;
    return !!(seo?.twitterTitle || article.metaTitle);
  }

  private countWords(text: string): number {
    if (!text) return 0;
    return text.replace(/<[^>]*>/g, '').split(/[\s\n]+/).filter((w) => w.length > 0).length;
  }

  private countSyllables(text: string): number {
    const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter((w) => w.length > 0);
    let count = 0;
    for (const word of words) {
      let syl = 0;
      const w = word.replace(/e$/, '').replace(/[aeiouy]{2,}/, 'a');
      syl = (w.match(/[aeiouy]/g) || []).length;
      count += Math.max(1, syl);
    }
    return count;
  }

  private extractFAQSchema(content: string): any | null {
    const faqPattern = /<h3>(?:faq|frequently asked questions|common questions)<\/h3>(.*?)(?=<h[23]|$)/is;
    const match = content.match(faqPattern);
    if (!match) return null;

    const questions = content.match(/<h4[^>]*>(.*?)<\/h4>/gi) || [];
    const answers = content.match(/<p>(.*?)<\/p>/gi) || [];

    if (questions.length === 0) return null;

    const mainEntity = questions.slice(0, Math.min(questions.length, 10)).map((q, i) => ({
      '@type': 'Question',
      name: q.replace(/<[^>]*>/g, ''),
      acceptedAnswer: {
        '@type': 'Answer',
        text: answers[i]?.replace(/<[^>]*>/g, '').substring(0, 200) || '',
      },
    }));

    return {
      '@type': 'FAQPage',
      mainEntity,
    };
  }

  private getScoreGrade(score: number): string {
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'fair';
    if (score >= 40) return 'poor';
    return 'critical';
  }

  private generateRecommendations(checklist: Record<string, any>): string[] {
    const recommendations: string[] = [];
    for (const [key, item] of Object.entries(checklist)) {
      if (!(item as any).passed) {
        recommendations.push((item as any).message);
      }
    }
    return recommendations.slice(0, 10);
  }
}

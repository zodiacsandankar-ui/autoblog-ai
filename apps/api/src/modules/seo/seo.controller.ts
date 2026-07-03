import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ValidationPipe,
  Header,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { SeoOptimizerService } from './seo-optimizer.service';

@ApiTags('SEO')
@ApiBearerAuth()
@Controller('seo')
export class SeoController {
  constructor(private readonly seoOptimizer: SeoOptimizerService) {}

  @Post('optimize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Optimize content for SEO' })
  @ApiResponse({ status: 200, description: 'Returns optimized content with SEO metadata' })
  async optimize(
    @Body() body: { content: string; keyword: string; options?: Record<string, any> },
  ) {
    return this.seoOptimizer.optimize(body.content, body.keyword, body.options);
  }

  @Post('audit/:articleId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Audit an article against SEO checklist' })
  @ApiResponse({ status: 200, description: 'Returns SEO audit results' })
  async audit(@Param('articleId', ParseUUIDPipe) articleId: string) {
    return this.seoOptimizer.audit(articleId);
  }

  @Get('sitemap/:projectId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate XML sitemap for a project' })
  @ApiResponse({ status: 200, description: 'Returns XML sitemap' })
  @Header('Content-Type', 'application/xml')
  async sitemap(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Res() res: Response,
  ) {
    const sitemap = await this.seoOptimizer.generateSitemap(projectId);
    res.send(sitemap);
  }

  @Post('schema/:articleId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate schema markup for an article' })
  @ApiResponse({ status: 200, description: 'Returns schema JSON-LD' })
  async schema(@Param('articleId', ParseUUIDPipe) articleId: string) {
    return this.seoOptimizer.generateSchema(articleId);
  }

  @Post('meta')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate meta tags for content' })
  @ApiResponse({ status: 200, description: 'Returns meta tags' })
  async meta(
    @Body() body: { title: string; content: string; keyword: string },
  ) {
    return this.seoOptimizer.generateMetaTags(body.title, body.content, body.keyword);
  }

  @Post('readability')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate readability score' })
  @ApiResponse({ status: 200, description: 'Returns readability metrics' })
  async readability(@Body() body: { content: string }) {
    return this.seoOptimizer.calculateReadabilityScore(body.content);
  }

  @Post('density')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Analyze keyword density in content' })
  @ApiResponse({ status: 200, description: 'Returns keyword density analysis' })
  async density(
    @Body() body: { content: string; keyword: string },
  ) {
    return this.seoOptimizer.analyzeKeywordDensity(body.content, body.keyword);
  }

  @Post('internal-links')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suggest internal linking opportunities' })
  @ApiResponse({ status: 200, description: 'Returns internal link suggestions' })
  async internalLinks(
    @Body() body: { articleId: string; projectId: string },
  ) {
    return this.seoOptimizer.suggestInternalLinks(body.articleId, body.projectId);
  }
}

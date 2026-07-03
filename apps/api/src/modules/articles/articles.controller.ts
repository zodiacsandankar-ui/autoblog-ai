import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ValidationPipe,
  Sse,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { BlogGeneratorService } from './blog-generator.service';
import { ArticleVersionService } from './article-version.service';
import { GenerateArticleDto } from './dto/generate-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

@ApiTags('Articles')
@ApiBearerAuth()
@Controller('articles')
export class ArticlesController {
  constructor(
    private readonly blogGenerator: BlogGeneratorService,
    private readonly versionService: ArticleVersionService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Generate a new article' })
  @ApiResponse({ status: 202, description: 'Article generation started' })
  async generate(
    @Body(new ValidationPipe({ transform: true })) dto: GenerateArticleDto,
  ) {
    return this.blogGenerator.generateArticle(dto.title, dto.topic, dto.options, dto.brief);
  }

  @Post('generate/stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate article with streaming response' })
  @ApiResponse({ status: 200, description: 'Streaming article generation' })
  @Sse()
  async generateStream(
    @Body(new ValidationPipe({ transform: true })) dto: GenerateArticleDto,
  ): Promise<Observable<MessageEvent>> {
    return this.blogGenerator.generateArticleStream(dto.title, dto.topic, dto.options, dto.brief);
  }

  @Get()
  @ApiOperation({ summary: 'Get all articles with filtering' })
  @ApiResponse({ status: 200, description: 'Returns paginated articles list' })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('projectId') projectId?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    return this.blogGenerator.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      status,
      search,
      projectId,
      sortBy,
      sortOrder,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single article by ID' })
  @ApiResponse({ status: 200, description: 'Returns the article' })
  @ApiResponse({ status: 404, description: 'Article not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.blogGenerator.findById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an article' })
  @ApiResponse({ status: 200, description: 'Article updated' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ValidationPipe({ transform: true })) dto: UpdateArticleDto,
  ) {
    return this.blogGenerator.updateArticle(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an article' })
  @ApiResponse({ status: 204, description: 'Article deleted' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.blogGenerator.deleteArticle(id);
  }

  @Post(':id/regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Regenerate article content' })
  @ApiResponse({ status: 202, description: 'Regeneration started' })
  async regenerate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() options?: { preserveImages?: boolean; tone?: string; style?: string },
  ) {
    return this.blogGenerator.regenerateArticle(id, options);
  }

  @Post(':id/humanize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Humanize article to reduce AI detection' })
  @ApiResponse({ status: 200, description: 'Article humanized' })
  async humanize(@Param('id', ParseUUIDPipe) id: string) {
    return this.blogGenerator.humanizeArticle(id);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Get article version history' })
  @ApiResponse({ status: 200, description: 'Returns version history' })
  async getVersions(@Param('id', ParseUUIDPipe) id: string) {
    return this.versionService.getVersions(id);
  }

  @Post(':id/versions/restore/:versionNumber')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a previous version of the article' })
  @ApiResponse({ status: 200, description: 'Version restored' })
  async restoreVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionNumber') versionNumber: string,
  ) {
    return this.versionService.restoreVersion(id, parseInt(versionNumber, 10));
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish article' })
  @ApiResponse({ status: 200, description: 'Article published' })
  async publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.blogGenerator.publishArticle(id);
  }

  @Post(':id/seo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run SEO optimization on article' })
  @ApiResponse({ status: 200, description: 'SEO optimization complete' })
  async seoOptimize(@Param('id', ParseUUIDPipe) id: string) {
    return this.blogGenerator.optimizeSEO(id);
  }
}

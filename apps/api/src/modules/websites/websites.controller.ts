import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ValidationPipe,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { WebsitesService } from './websites.service';
import { CreateWebsiteDto } from './dto/create-website.dto';
import { UpdateThemeDto } from './dto/update-theme.dto';
import { CreatePageDto } from './dto/create-page.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { CommentStatus, PageStatus } from '@prisma/client';

@ApiTags('Websites')
@Controller('websites')
export class WebsitesController {
  private readonly logger = new Logger(WebsitesController.name);

  constructor(private readonly websitesService: WebsitesService) {}

  // -----------------------------------------------------------------------
  // Website CRUD
  // -----------------------------------------------------------------------

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new website for a project' })
  @ApiResponse({ status: 201, description: 'Website created' })
  @ApiResponse({ status: 409, description: 'Subdomain or domain taken' })
  async create(
    @CurrentUser() user: JwtUser,
    @Body(new ValidationPipe({ transform: true })) dto: CreateWebsiteDto,
  ) {
    return this.websitesService.createWebsite(dto.projectId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get website details by ID' })
  @ApiResponse({ status: 200, description: 'Website details' })
  @ApiResponse({ status: 404, description: 'Website not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const website = await this.websitesService.findById(id);
    if (!website) {
      return { message: 'Website not found' };
    }
    return website;
  }

  @Get('by-project/:projectId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get website by project ID' })
  async findByProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.websitesService.findByProjectId(projectId);
  }

  @Get('resolve/:domain')
  @ApiOperation({ summary: 'Resolve a published website by domain/subdomain' })
  @ApiResponse({ status: 200, description: 'Published website data' })
  async resolveDomain(@Param('domain') domain: string) {
    const website = await this.websitesService.getPublishedWebsite(domain);
    if (!website) {
      return { message: 'Website not found or not published' };
    }
    return website;
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a website' })
  async publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.websitesService.publishWebsite(id);
  }

  @Post(':id/unpublish')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unpublish a website' })
  async unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.websitesService.unpublishWebsite(id);
  }

  // -----------------------------------------------------------------------
  // Theme
  // -----------------------------------------------------------------------

  @Get('themes/list')
  @ApiOperation({ summary: 'List all available themes' })
  @ApiResponse({ status: 200, description: 'Available themes' })
  async getThemes() {
    return this.websitesService.getThemes();
  }

  @Post(':id/theme')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update website theme configuration' })
  async updateTheme(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ValidationPipe({ transform: true })) dto: UpdateThemeDto,
  ) {
    const themeConfig = dto.themeConfig || {
      ...(dto.primaryColor && { primaryColor: dto.primaryColor }),
      ...(dto.secondaryColor && { secondaryColor: dto.secondaryColor }),
      ...(dto.backgroundColor && { backgroundColor: dto.backgroundColor }),
      ...(dto.textColor && { textColor: dto.textColor }),
      ...(dto.accentColor && { accentColor: dto.accentColor }),
      ...(dto.fonts && { fonts: dto.fonts }),
      ...(dto.layout && { layout: dto.layout }),
      ...(dto.customCss && { customCss: dto.customCss }),
    };
    return this.websitesService.updateTheme(id, themeConfig);
  }

  @Post(':id/theme/install/:themeId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Install a theme on a website' })
  async installTheme(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('themeId') themeId: string,
  ) {
    return this.websitesService.installTheme(id, themeId);
  }

  // -----------------------------------------------------------------------
  // Custom Domain
  // -----------------------------------------------------------------------

  @Post(':id/domain')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a custom domain to a website' })
  async addCustomDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('domain') domain: string,
  ) {
    return this.websitesService.addCustomDomain(id, domain);
  }

  @Delete(':id/domain')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove custom domain from a website' })
  async removeCustomDomain(@Param('id', ParseUUIDPipe) id: string) {
    return this.websitesService.removeCustomDomain(id);
  }

  // -----------------------------------------------------------------------
  // Pages
  // -----------------------------------------------------------------------

  @Get(':id/pages')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all pages for a website' })
  async getPages(@Param('id', ParseUUIDPipe) id: string) {
    return this.websitesService.getPages(id);
  }

  @Post(':id/pages')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new custom page' })
  @ApiResponse({ status: 201, description: 'Page created' })
  async createPage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ValidationPipe({ transform: true })) dto: CreatePageDto,
  ) {
    return this.websitesService.createPage(id, dto);
  }

  @Put('pages/:pageId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a custom page' })
  async updatePage(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: Partial<CreatePageDto>,
  ) {
    return this.websitesService.updatePage(pageId, dto);
  }

  @Delete('pages/:pageId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a custom page' })
  async deletePage(@Param('pageId', ParseUUIDPipe) pageId: string) {
    await this.websitesService.deletePage(pageId);
    return { message: 'Page deleted' };
  }

  // -----------------------------------------------------------------------
  // Comments
  // -----------------------------------------------------------------------

  @Get('comments/:articleId')
  @ApiOperation({ summary: 'Get paginated comments for an article' })
  @ApiQuery({ name: 'status', required: false, enum: CommentStatus })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getComments(
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Query('status') status?: CommentStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.websitesService.getComments(articleId, status, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Post('comments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a comment on an article (guest or user)' })
  @ApiResponse({ status: 201, description: 'Comment created' })
  async createComment(
    @Body(new ValidationPipe({ transform: true })) dto: CreateCommentDto,
  ) {
    return this.websitesService.createComment(dto.articleId, dto);
  }

  @Put('comments/:commentId/moderate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Moderate a comment (approve/reject/spam)' })
  async moderateComment(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body('status') status: CommentStatus,
  ) {
    return this.websitesService.moderateComment(commentId, status);
  }

  // -----------------------------------------------------------------------
  // Subscribers
  // -----------------------------------------------------------------------

  @Get(':id/subscribers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get newsletter subscribers for a website' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getSubscribers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.websitesService.getSubscribers(id, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Post(':id/subscribers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a subscriber to a website newsletter' })
  async addSubscriber(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('email') email: string,
    @Body('name') name?: string,
  ) {
    return this.websitesService.addSubscriber(id, email, name);
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unsubscribe using a token' })
  async unsubscribe(@Body('token') token: string) {
    await this.websitesService.unsubscribe(token);
    return { message: 'Successfully unsubscribed' };
  }

  @Get(':id/subscribers/export')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export subscribers as CSV or JSON' })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'json'] })
  async exportSubscribers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format?: string,
  ) {
    const fmt = format === 'csv' ? 'csv' : 'json';
    const data = await this.websitesService.exportSubscribers(id, fmt);

    if (fmt === 'csv') {
      return data; // Buffer will be streamed
    }

    return JSON.parse(data as string);
  }
}

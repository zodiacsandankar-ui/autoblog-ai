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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PublishingService } from './publishing.service';

@ApiTags('Publishing')
@ApiBearerAuth()
@Controller('publishing')
export class PublishingController {
  constructor(private readonly publishingService: PublishingService) {}

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish an article to configured platforms' })
  @ApiResponse({ status: 200, description: 'Publishing initiated' })
  async publish(
    @Body() body: { articleId: string; platforms?: string[] },
  ) {
    return this.publishingService.publish(body.articleId, body.platforms);
  }

  @Post('cross-post')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cross-post an article to specific platforms' })
  @ApiResponse({ status: 200, description: 'Cross-posting complete' })
  async crossPost(
    @Body() body: { articleId: string; platforms: string[] },
  ) {
    return this.publishingService.crossPost(body.articleId, body.platforms);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get publishing history' })
  @ApiResponse({ status: 200, description: 'Returns publishing history' })
  async getHistory(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('articleId') articleId?: string,
    @Query('projectId') projectId?: string,
    @Query('platform') platform?: string,
    @Query('success') success?: string,
  ) {
    return this.publishingService.getPublishHistory({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      articleId,
      projectId,
      platform,
      success: success !== undefined ? success === 'true' : undefined,
    });
  }

  @Get('platforms')
  @ApiOperation({ summary: 'Get available publishing platforms' })
  @ApiResponse({ status: 200, description: 'Returns platforms list' })
  async getPlatforms() {
    return this.publishingService.getPlatforms();
  }
}

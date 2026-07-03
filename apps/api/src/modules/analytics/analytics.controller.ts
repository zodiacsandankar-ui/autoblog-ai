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
import { AnalyticsService } from './analytics.service';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard/:projectId')
  @ApiOperation({ summary: 'Get dashboard statistics for a project' })
  @ApiResponse({ status: 200, description: 'Returns dashboard stats' })
  async getDashboard(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.analyticsService.getDashboardStats(projectId);
  }

  @Get('traffic/:projectId')
  @ApiOperation({ summary: 'Get traffic data for a project' })
  @ApiResponse({ status: 200, description: 'Returns traffic data' })
  async getTraffic(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analyticsService.getTrafficData(projectId, {
      startDate: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000),
      endDate: endDate ? new Date(endDate) : new Date(),
    });
  }

  @Get('rankings/:projectId')
  @ApiOperation({ summary: 'Get keyword rankings for a project' })
  @ApiResponse({ status: 200, description: 'Returns keyword rankings' })
  async getRankings(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.analyticsService.getKeywordRankings(projectId);
  }

  @Get('top-articles/:projectId')
  @ApiOperation({ summary: 'Get top performing articles' })
  @ApiResponse({ status: 200, description: 'Returns top articles' })
  async getTopArticles(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('limit') limit?: string,
  ) {
    return this.analyticsService.getTopArticles(projectId, limit ? parseInt(limit, 10) : 10);
  }

  @Get('token-usage/:projectId')
  @ApiOperation({ summary: 'Get token usage analytics' })
  @ApiResponse({ status: 200, description: 'Returns token usage data' })
  async getTokenUsage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analyticsService.getTokenUsage(projectId, {
      startDate: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000),
      endDate: endDate ? new Date(endDate) : new Date(),
    });
  }

  @Get('insights/:projectId')
  @ApiOperation({ summary: 'Get AI-powered insights for a project' })
  @ApiResponse({ status: 200, description: 'Returns actionable insights' })
  async getInsights(@Param('projectId', ParseUUIDPipe) projectId: string) {
    const stats = await this.analyticsService.getDashboardStats(projectId);
    return this.analyticsService.generateInsights(stats);
  }

  @Post('snapshot/:projectId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take a manual analytics snapshot' })
  @ApiResponse({ status: 200, description: 'Snapshot taken' })
  async snapshot(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.analyticsService.snapshotAnalytics(projectId);
  }
}

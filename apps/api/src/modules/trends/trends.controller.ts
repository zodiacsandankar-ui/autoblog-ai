import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { TrendDiscoveryService } from './trend-discovery.service';
import { TrendFilterDto, TrendCategory } from './dto/trend-filter.dto';

@ApiTags('Trends')
@ApiBearerAuth()
@Controller('trends')
export class TrendsController {
  constructor(private readonly trendDiscoveryService: TrendDiscoveryService) {}

  @Get()
  @ApiOperation({ summary: 'Get all trends with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Returns paginated trends list' })
  async findAll(@Query(new ValidationPipe({ transform: true })) filter: TrendFilterDto) {
    return this.trendDiscoveryService.findAll(filter);
  }

  @Get('opportunities')
  @ApiOperation({ summary: 'Get trend opportunities (high-growth, low-competition trends)' })
  @ApiResponse({ status: 200, description: 'Returns trend opportunities' })
  async getOpportunities(
    @Query('minScore') minScore?: number,
    @Query('category') category?: TrendCategory,
    @Query('limit') limit?: number,
  ) {
    return this.trendDiscoveryService.findOpportunities({
      minScore: minScore ? Number(minScore) : 60,
      category,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get('sources')
  @ApiOperation({ summary: 'Get all available trend sources' })
  @ApiResponse({ status: 200, description: 'Returns list of trend sources' })
  async getSources() {
    return this.trendDiscoveryService.getSources();
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get trend statistics and aggregation data' })
  @ApiResponse({ status: 200, description: 'Returns trend statistics' })
  async getStats(
    @Query('days') days?: number,
  ) {
    return this.trendDiscoveryService.getStats(days ? Number(days) : 30);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single trend by ID' })
  @ApiResponse({ status: 200, description: 'Returns the trend' })
  @ApiResponse({ status: 404, description: 'Trend not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.trendDiscoveryService.findById(id);
  }

  @Post('discover')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Manually trigger trend discovery' })
  @ApiResponse({ status: 202, description: 'Trend discovery triggered' })
  async discover(
    @Body() options?: { sources?: string[]; forceRefresh?: boolean },
  ) {
    return this.trendDiscoveryService.manualDiscover(options);
  }

  @Get(':id/related')
  @ApiOperation({ summary: 'Get related trends for a trend' })
  @ApiResponse({ status: 200, description: 'Returns related trends' })
  async getRelated(@Param('id', ParseUUIDPipe) id: string) {
    return this.trendDiscoveryService.findRelated(id);
  }
}

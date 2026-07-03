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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { KeywordIntelligenceService } from './keyword-intelligence.service';
import {
  KeywordResearchDto,
  ClusterKeywordsDto,
  ContentGapDto,
  KeywordResearchOptionsDto,
} from './dto/keyword-research.dto';

@ApiTags('Keywords')
@ApiBearerAuth()
@Controller('keywords')
export class KeywordsController {
  constructor(private readonly keywordService: KeywordIntelligenceService) {}

  @Post('research')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Research keywords for a given topic' })
  @ApiResponse({ status: 200, description: 'Returns comprehensive keyword research' })
  async research(
    @Body(new ValidationPipe({ transform: true })) dto: KeywordResearchDto,
  ) {
    return this.keywordService.researchKeywords(dto.topic, dto.options);
  }

  @Get()
  @ApiOperation({ summary: 'Get all researched keywords with filtering' })
  @ApiResponse({ status: 200, description: 'Returns paginated keyword list' })
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('cluster') cluster?: string,
    @Query('intent') intent?: string,
    @Query('minVolume') minVolume?: number,
  ) {
    return this.keywordService.findAll({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      search,
      cluster,
      intent,
      minVolume: minVolume ? Number(minVolume) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single keyword by ID' })
  @ApiResponse({ status: 200, description: 'Returns the keyword' })
  @ApiResponse({ status: 404, description: 'Keyword not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.keywordService.findById(id);
  }

  @Post('cluster')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cluster keywords into semantic groups' })
  @ApiResponse({ status: 200, description: 'Returns clustered keyword groups' })
  async cluster(
    @Body(new ValidationPipe({ transform: true })) dto: ClusterKeywordsDto,
  ) {
    return this.keywordService.clusterKeywords(dto.keywords, dto.clusterCount);
  }

  @Post('gaps')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Find content gaps between competitors and your content' })
  @ApiResponse({ status: 200, description: 'Returns content gap analysis' })
  async gaps(
    @Body(new ValidationPipe({ transform: true })) dto: ContentGapDto,
  ) {
    return this.keywordService.findContentGaps(dto.competitorUrls, dto.myContent, dto.topic);
  }

  @Get('stats/overview')
  @ApiOperation({ summary: 'Get keyword research statistics' })
  @ApiResponse({ status: 200, description: 'Returns keyword stats' })
  async getStats() {
    return this.keywordService.getStats();
  }
}

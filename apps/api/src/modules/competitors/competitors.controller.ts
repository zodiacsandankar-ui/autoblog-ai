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
import { CompetitorResearchService } from './competitor-research.service';
import {
  CompetitorAnalysisDto,
  CompetitorAnalysisOptionsDto,
} from './dto/competitor-analysis.dto';

@ApiTags('Competitors')
@ApiBearerAuth()
@Controller('competitors')
export class CompetitorsController {
  constructor(private readonly competitorService: CompetitorResearchService) {}

  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Analyze competitors for a keyword' })
  @ApiResponse({ status: 200, description: 'Returns competitor analysis results' })
  async analyze(
    @Body(new ValidationPipe({ transform: true })) dto: CompetitorAnalysisDto,
  ) {
    return this.competitorService.analyzeCompetitors(dto.keyword, dto.options);
  }

  @Get()
  @ApiOperation({ summary: 'Get all competitor analyses' })
  @ApiResponse({ status: 200, description: 'Returns paginated analyses list' })
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('keyword') keyword?: string,
  ) {
    return this.competitorService.findAll({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      keyword,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a competitor analysis by ID' })
  @ApiResponse({ status: 200, description: 'Returns the analysis' })
  @ApiResponse({ status: 404, description: 'Analysis not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.competitorService.findById(id);
  }

  @Get(':id/opportunities')
  @ApiOperation({ summary: 'Get content opportunities from competitor analysis' })
  @ApiResponse({ status: 200, description: 'Returns content opportunities' })
  async getOpportunities(@Param('id', ParseUUIDPipe) id: string) {
    return this.competitorService.findOpportunities(id);
  }
}

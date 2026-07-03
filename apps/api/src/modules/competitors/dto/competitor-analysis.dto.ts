import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsArray,
  IsBoolean,
  IsObject,
  IsUrl,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AnalysisDepth {
  QUICK = 'quick',
  STANDARD = 'standard',
  DEEP = 'deep',
  COMPREHENSIVE = 'comprehensive',
}

export class CompetitorAnalysisOptionsDto {
  @ApiPropertyOptional({ description: 'Depth of analysis', default: 'standard' })
  @IsOptional()
  @IsEnum(AnalysisDepth)
  depth?: AnalysisDepth;

  @ApiPropertyOptional({ description: 'Include backlink analysis', default: false })
  @IsOptional()
  @IsBoolean()
  includeBacklinks?: boolean;

  @ApiPropertyOptional({ description: 'Include Lighthouse performance audit', default: false })
  @IsOptional()
  @IsBoolean()
  includeLighthouse?: boolean;

  @ApiPropertyOptional({ description: 'Include schema markup analysis', default: true })
  @IsOptional()
  @IsBoolean()
  includeSchema?: boolean;

  @ApiPropertyOptional({ description: 'Include FAQ extraction', default: true })
  @IsOptional()
  @IsBoolean()
  includeFAQ?: boolean;

  @ApiPropertyOptional({ description: 'Maximum competitors to analyze', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxCompetitors?: number;

  @ApiPropertyOptional({ description: 'Target country for localized results', default: 'US' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: 'Target language', default: 'en' })
  @IsOptional()
  @IsString()
  language?: string;
}

export class CompetitorAnalysisDto {
  @ApiProperty({ description: 'Target keyword for competitor analysis' })
  @IsString()
  keyword: string;

  @ApiPropertyOptional({ description: 'Analysis options' })
  @IsOptional()
  @IsObject()
  options?: CompetitorAnalysisOptionsDto;
}

export class SingleCompetitorAnalysisDto {
  @ApiProperty({ description: 'Competitor URL to analyze' })
  @IsUrl({ protocols: ['http', 'https'] })
  url: string;

  @ApiProperty({ description: 'Target keyword context' })
  @IsString()
  keyword: string;

  @ApiPropertyOptional({ description: 'Analysis options' })
  @IsOptional()
  @IsObject()
  options?: CompetitorAnalysisOptionsDto;
}

export class CompetitorPageData {
  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  metaDescription?: string;

  @ApiProperty({ type: [String] })
  headings: string[];

  @ApiProperty()
  wordCount: number;

  @ApiProperty()
  readabilityScore: number;

  @ApiProperty({ type: [String] })
  internalLinks: string[];

  @ApiProperty({ type: [String] })
  externalLinks: string[];

  @ApiProperty({ type: [String] })
  images: string[];

  @ApiProperty({ type: [String] })
  schemaTypes: string[];

  @ApiPropertyOptional()
  faqData?: any;

  @ApiPropertyOptional()
  backlinks?: number;

  @ApiPropertyOptional()
  domainAuthority?: number;

  @ApiPropertyOptional()
  lighthouseScore?: number;

  @ApiProperty()
  url: string;

  @ApiProperty()
  analyzedAt: Date;
}

export class CompetitorAnalysisResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  keyword: string;

  @ApiProperty({ type: [CompetitorPageData] })
  competitors: CompetitorPageData[];

  @ApiProperty()
  summary: any;

  @ApiProperty()
  opportunities: string[];

  @ApiProperty()
  contentGaps: any[];

  @ApiProperty()
  createdAt: Date;
}

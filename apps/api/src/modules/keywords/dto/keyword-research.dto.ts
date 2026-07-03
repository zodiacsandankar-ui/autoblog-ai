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
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum KeywordDifficulty {
  VERY_EASY = 'very_easy',
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard',
  VERY_HARD = 'very_hard',
}

export enum SearchIntent {
  INFORMATIONAL = 'informational',
  NAVIGATIONAL = 'navigational',
  COMMERCIAL = 'commercial',
  TRANSACTIONAL = 'transactional',
}

export class KeywordResearchOptionsDto {
  @ApiPropertyOptional({ description: 'Target country code (ISO 3166-1 alpha-2)', default: 'US' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: 'Target language code', default: 'en' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'Search engine domain', default: 'google.com' })
  @IsOptional()
  @IsString()
  searchEngine?: string;

  @ApiPropertyOptional({ description: 'Include People Also Ask data', default: true })
  @IsOptional()
  @IsBoolean()
  includePAA?: boolean;

  @ApiPropertyOptional({ description: 'Include related searches', default: true })
  @IsOptional()
  @IsBoolean()
  includeRelated?: boolean;

  @ApiPropertyOptional({ description: 'Include question-based keywords', default: true })
  @IsOptional()
  @IsBoolean()
  includeQuestions?: boolean;

  @ApiPropertyOptional({ description: 'Include SERP feature data', default: true })
  @IsOptional()
  @IsBoolean()
  includeSERPFeatures?: boolean;

  @ApiPropertyOptional({ description: 'Maximum keywords to return', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  maxKeywords?: number;

  @ApiPropertyOptional({ description: 'Minimum search volume filter' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minVolume?: number;

  @ApiPropertyOptional({ description: 'Maximum keyword difficulty filter' })
  @IsOptional()
  @IsEnum(KeywordDifficulty)
  maxDifficulty?: KeywordDifficulty;

  @ApiPropertyOptional({ description: 'Target search intent filter' })
  @IsOptional()
  @IsArray()
  @IsEnum(SearchIntent, { each: true })
  intents?: SearchIntent[];
}

export class KeywordResearchDto {
  @ApiProperty({ description: 'Seed topic or keyword for research' })
  @IsString()
  topic: string;

  @ApiPropertyOptional({ description: 'Research options' })
  @IsOptional()
  @IsObject()
  options?: KeywordResearchOptionsDto;
}

export class ClusterKeywordsDto {
  @ApiProperty({ description: 'Array of keywords to cluster', type: [String] })
  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @ApiPropertyOptional({ description: 'Number of clusters to generate' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(50)
  clusterCount?: number;
}

export class ContentGapDto {
  @ApiProperty({ description: 'Array of competitor URLs to analyze', type: [String] })
  @IsArray()
  @IsString({ each: true })
  competitorUrls: string[];

  @ApiProperty({ description: 'Array of own content URLs or titles', type: [String] })
  @IsArray()
  @IsString({ each: true })
  myContent: string[];

  @ApiPropertyOptional({ description: 'Topic focus for gap analysis' })
  @IsOptional()
  @IsString()
  topic?: string;
}

export class KeywordResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  keyword: string;

  @ApiPropertyOptional()
  searchVolume?: number;

  @ApiPropertyOptional()
  cpc?: number;

  @ApiPropertyOptional()
  competition?: string;

  @ApiPropertyOptional()
  difficulty?: string;

  @ApiPropertyOptional()
  intent?: string;

  @ApiPropertyOptional()
  trend?: string;

  @ApiProperty({ type: [String] })
  relatedKeywords: string[];

  @ApiProperty({ type: [String] })
  questions: string[];

  @ApiProperty()
  clusterId?: string;

  @ApiProperty()
  opportunityScore?: number;

  @ApiProperty()
  createdAt: Date;
}

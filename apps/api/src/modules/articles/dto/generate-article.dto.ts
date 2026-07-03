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
  IsUUID,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ArticleTone {
  PROFESSIONAL = 'professional',
  CONVERSATIONAL = 'conversational',
  AUTHORITATIVE = 'authoritative',
  FRIENDLY = 'friendly',
  PERSUASIVE = 'persuasive',
  EDUCATIONAL = 'educational',
  STORYTELLING = 'storytelling',
  FORMAL = 'formal',
  CASUAL = 'casual',
  INSPIRATIONAL = 'inspirational',
}

export enum ArticleStyle {
  HOW_TO = 'how_to',
  LISTICLE = 'listicle',
  GUIDE = 'guide',
  OPINION = 'opinion',
  NEWS = 'news',
  REVIEW = 'review',
  COMPARISON = 'comparison',
  INTERVIEW = 'interview',
  CASE_STUDY = 'case_study',
  ULTIMATE_GUIDE = 'ultimate_guide',
  BEGINNER_GUIDE = 'beginner_guide',
  STEP_BY_STEP = 'step_by_step',
  TIPS_AND_TRICKS = 'tips_and_tricks',
  FAQ = 'faq',
  THOUGHT_LEADERSHIP = 'thought_leadership',
}

export enum ArticleAudience {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  EXPERT = 'expert',
  GENERAL = 'general',
  TECHNICAL = 'technical',
  BUSINESS = 'business',
  DEVELOPER = 'developer',
  MARKETER = 'marketer',
}

export class ContentGapReference {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  competitorUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  missingTopics?: string[];
}

export class GenerateArticleOptionsDto {
  @ApiPropertyOptional({ description: 'Target word count', default: 1500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(300)
  @Max(10000)
  wordCount?: number;

  @ApiPropertyOptional({ enum: ArticleTone, default: ArticleTone.PROFESSIONAL })
  @IsOptional()
  @IsEnum(ArticleTone)
  tone?: ArticleTone;

  @ApiPropertyOptional({ enum: ArticleStyle, default: ArticleStyle.GUIDE })
  @IsOptional()
  @IsEnum(ArticleStyle)
  style?: ArticleStyle;

  @ApiPropertyOptional({ enum: ArticleAudience, default: ArticleAudience.GENERAL })
  @IsOptional()
  @IsEnum(ArticleAudience)
  audience?: ArticleAudience;

  @ApiPropertyOptional({ type: [String], description: 'Primary keywords to target' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  primaryKeywords?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Secondary keywords to naturally include' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  secondaryKeywords?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Sections/structure to include' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mustInclude?: string[];

  @ApiPropertyOptional({ description: 'Generate images for article', default: true })
  @IsOptional()
  @IsBoolean()
  generateImages?: boolean;

  @ApiPropertyOptional({ description: 'Run AI detection check', default: true })
  @IsOptional()
  @IsBoolean()
  aiDetection?: boolean;

  @ApiPropertyOptional({ description: 'Enable streaming generation', default: true })
  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @ApiPropertyOptional({ type: [ContentGapReference] })
  @IsOptional()
  @IsArray()
  contentGaps?: ContentGapReference[];

  @ApiPropertyOptional({ description: 'Target URLs for internal linking' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  internalLinkingUrls?: string[];

  @ApiPropertyOptional({ description: 'Additional context or instructions' })
  @IsOptional()
  @IsString()
  additionalInstructions?: string;

  @ApiPropertyOptional({ description: 'Project ID for association' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Number of headings to generate', default: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(30)
  headingCount?: number;

  @ApiPropertyOptional({ description: 'Include FAQ section', default: true })
  @IsOptional()
  @IsBoolean()
  includeFAQ?: boolean;

  @ApiPropertyOptional({ description: 'Include table of contents', default: true })
  @IsOptional()
  @IsBoolean()
  includeTOC?: boolean;
}

export class GenerateArticleDto {
  @ApiProperty({ description: 'Article title' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: 'Article slug (auto-generated if empty)' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ description: 'Brief description for article generation' })
  @IsOptional()
  @IsString()
  brief?: string;

  @ApiProperty({ description: 'Main topic or subject' })
  @IsString()
  topic: string;

  @ApiPropertyOptional({ description: 'Generation options' })
  @IsOptional()
  @IsObject()
  options?: GenerateArticleOptionsDto;
}

export class ArticleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  slug: string;

  @ApiPropertyOptional()
  content?: string;

  @ApiPropertyOptional()
  excerpt?: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  wordCount: number;

  @ApiPropertyOptional()
  readingTime?: number;

  @ApiProperty()
  tone: string;

  @ApiProperty()
  style: string;

  @ApiProperty()
  audience: string;

  @ApiProperty({ type: [String] })
  keywords: string[];

  @ApiPropertyOptional()
  metaTitle?: string;

  @ApiPropertyOptional()
  metaDescription?: string;

  @ApiPropertyOptional()
  featuredImage?: string;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty()
  version: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class ArticleListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  wordCount: number;

  @ApiPropertyOptional()
  readingTime?: number;

  @ApiProperty()
  version: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional()
  featuredImage?: string;

  @ApiProperty({ type: [String] })
  tags: string[];
}

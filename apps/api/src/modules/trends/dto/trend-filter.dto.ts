import { IsOptional, IsString, IsEnum, IsInt, Min, Max, IsArray, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TrendSortField {
  TITLE = 'title',
  SCORE = 'score',
  VOLUME = 'volume',
  GROWTH = 'growthRate',
  CREATED_AT = 'createdAt',
  CATEGORY = 'category',
}

export enum TrendCategory {
  TECHNOLOGY = 'technology',
  BUSINESS = 'business',
  HEALTH = 'health',
  SCIENCE = 'science',
  ENTERTAINMENT = 'entertainment',
  SPORTS = 'sports',
  POLITICS = 'politics',
  EDUCATION = 'education',
  LIFESTYLE = 'lifestyle',
  FINANCE = 'finance',
  AI = 'ai',
  SEO = 'seo',
  MARKETING = 'marketing',
  OTHER = 'other',
}

export enum TrendStatus {
  ACTIVE = 'active',
  DECLINING = 'declining',
  STABLE = 'stable',
  EXPIRED = 'expired',
}

export class TrendFilterDto {
  @ApiPropertyOptional({ description: 'Search query for trend title' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: TrendCategory, description: 'Filter by category' })
  @IsOptional()
  @IsEnum(TrendCategory)
  category?: TrendCategory;

  @ApiPropertyOptional({ enum: TrendStatus, description: 'Filter by status' })
  @IsOptional()
  @IsEnum(TrendStatus)
  status?: TrendStatus;

  @ApiPropertyOptional({ description: 'Minimum trend score (0-100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @ApiPropertyOptional({ description: 'Maximum trend score (0-100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  maxScore?: number;

  @ApiPropertyOptional({ description: 'Minimum search volume' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minVolume?: number;

  @ApiPropertyOptional({ description: 'Source of trend data' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: 'Start date for trend discovery' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date for trend discovery' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: TrendSortField, description: 'Field to sort by' })
  @IsOptional()
  @IsEnum(TrendSortField)
  sortBy?: TrendSortField;

  @ApiPropertyOptional({ description: 'Sort order', default: 'DESC' })
  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC';

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Comma-separated list of related topics' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  relatedTopics?: string[];
}

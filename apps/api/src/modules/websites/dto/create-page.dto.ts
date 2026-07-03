import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsObject,
  IsArray,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageStatus } from '@prisma/client';

class PageBlock {
  @IsString()
  id: string;

  @IsString()
  type: string;

  @IsObject()
  content: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  styles?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class CreatePageDto {
  @ApiProperty({
    description: 'Website ID this page belongs to',
    example: 'web_abc123',
  })
  @IsUUID()
  websiteId: string;

  @ApiProperty({
    description: 'URL slug for the page',
    example: 'about-us',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  slug: string;

  @ApiProperty({
    description: 'Page title',
    example: 'About Us',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({
    description: 'Meta description for SEO',
    example: 'Learn more about our company and mission.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  metaDescription?: string;

  @ApiPropertyOptional({
    description: 'Page content blocks',
    type: [PageBlock],
  })
  @IsOptional()
  @IsArray()
  blocks?: PageBlock[];

  @ApiPropertyOptional({
    description: 'Schema markup for the page',
  })
  @IsOptional()
  @IsObject()
  schemaMarkup?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Canonical URL override',
  })
  @IsOptional()
  @IsString()
  canonicalUrl?: string;

  @ApiPropertyOptional({
    description: 'Whether to set noindex on this page',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  noindex?: boolean;

  @ApiPropertyOptional({
    description: 'Page status',
    enum: PageStatus,
    default: PageStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(PageStatus)
  status?: PageStatus;
}

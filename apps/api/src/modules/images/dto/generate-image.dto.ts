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
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ImageProvider {
  DALLE3 = 'dalle3',
  MIDJOURNEY = 'midjourney',
  STABLE_DIFFUSION = 'stable_diffusion',
  LEONARDO = 'leonardo',
  IDEOGRAM = 'ideogram',
  FIREFLY = 'firefly',
}

export enum ImageStyle {
  REALISTIC = 'realistic',
  VECTOR = 'vector',
  WATERCOLOR = 'watercolor',
  OIL_PAINTING = 'oil_painting',
  DIGITAL_ART = 'digital_art',
  PHOTOGRAPHIC = 'photographic',
  CINEMATIC = 'cinematic',
  ANIME = 'anime',
  CARTOON = 'cartoon',
  LINE_ART = 'line_art',
  PIXEL_ART = 'pixel_art',
  _3D_RENDER = '3d_render',
  ISOMETRIC = 'isometric',
  MINIMALIST = 'minimalist',
  ABSTRACT = 'abstract',
  SCHEMA = 'schema',
}

export enum ImageAspectRatio {
  SQUARE = '1:1',
  LANDSCAPE = '16:9',
  PORTRAIT = '9:16',
  WIDE = '4:3',
  TALL = '3:4',
  BANNER = '21:9',
}

export enum ImageSize {
  SMALL = '256x256',
  MEDIUM = '512x512',
  LARGE = '1024x1024',
  XLARGE = '1792x1024',
  XXLARGE = '1024x1792',
}

export class ImageVariantConfig {
  @ApiPropertyOptional({ description: 'Generate thumbnail variant', default: true })
  @IsOptional()
  @IsBoolean()
  thumbnail?: boolean;

  @ApiPropertyOptional({ description: 'Generate medium variant', default: true })
  @IsOptional()
  @IsBoolean()
  medium?: boolean;

  @ApiPropertyOptional({ description: 'Generate large variant', default: true })
  @IsOptional()
  @IsBoolean()
  large?: boolean;

  @ApiPropertyOptional({ description: 'Generate OG image variant', default: true })
  @IsOptional()
  @IsBoolean()
  og?: boolean;

  @ApiPropertyOptional({ description: 'Generate Pinterest variant', default: false })
  @IsOptional()
  @IsBoolean()
  pinterest?: boolean;
}

export class GenerateImageOptionsDto {
  @ApiPropertyOptional({ enum: ImageProvider, description: 'Preferred provider chain' })
  @IsOptional()
  @IsEnum(ImageProvider)
  preferredProvider?: ImageProvider;

  @ApiPropertyOptional({ type: [String], enum: ImageProvider, description: 'Provider chain fallback order' })
  @IsOptional()
  @IsArray()
  @IsEnum(ImageProvider, { each: true })
  providerChain?: ImageProvider[];

  @ApiPropertyOptional({ enum: ImageStyle, default: ImageStyle.REALISTIC })
  @IsOptional()
  @IsEnum(ImageStyle)
  style?: ImageStyle;

  @ApiPropertyOptional({ enum: ImageAspectRatio, default: ImageAspectRatio.LANDSCAPE })
  @IsOptional()
  @IsEnum(ImageAspectRatio)
  aspectRatio?: ImageAspectRatio;

  @ApiPropertyOptional({ enum: ImageSize, default: ImageSize.LARGE })
  @IsOptional()
  @IsEnum(ImageSize)
  size?: ImageSize;

  @ApiPropertyOptional({ description: 'Number of images to generate', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  count?: number;

  @ApiPropertyOptional({ description: 'Generate image variants', default: true })
  @IsOptional()
  @IsBoolean()
  generateVariants?: boolean;

  @ApiPropertyOptional({ description: 'Variant configuration' })
  @IsOptional()
  @IsObject()
  variants?: ImageVariantConfig;

  @ApiPropertyOptional({ description: 'Convert to WebP', default: true })
  @IsOptional()
  @IsBoolean()
  webp?: boolean;

  @ApiPropertyOptional({ description: 'Convert to AVIF', default: false })
  @IsOptional()
  @IsBoolean()
  avif?: boolean;

  @ApiPropertyOptional({ description: 'Upload to CDN', default: true })
  @IsOptional()
  @IsBoolean()
  uploadToCDN?: boolean;

  @ApiPropertyOptional({ description: 'Negative prompt (what to avoid)' })
  @IsOptional()
  @IsString()
  negativePrompt?: string;

  @ApiPropertyOptional({ description: 'Reference image URL for img2img' })
  @IsOptional()
  @IsString()
  referenceImage?: string;

  @ApiPropertyOptional({ description: 'Seed for reproducibility' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  seed?: number;
}

export class GenerateImageDto {
  @ApiProperty({ description: 'Prompt for image generation' })
  @IsString()
  prompt: string;

  @ApiPropertyOptional({ description: 'Article ID to associate images with' })
  @IsOptional()
  @IsString()
  articleId?: string;

  @ApiPropertyOptional({ description: 'Project ID' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Image generation options' })
  @IsOptional()
  @IsObject()
  options?: GenerateImageOptionsDto;
}

export class ImageResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  url: string;

  @ApiPropertyOptional()
  thumbnailUrl?: string;

  @ApiPropertyOptional()
  mediumUrl?: string;

  @ApiPropertyOptional()
  largeUrl?: string;

  @ApiPropertyOptional()
  ogUrl?: string;

  @ApiPropertyOptional()
  pinterestUrl?: string;

  @ApiProperty()
  prompt: string;

  @ApiProperty()
  provider: string;

  @ApiProperty()
  style: string;

  @ApiProperty()
  width: number;

  @ApiProperty()
  height: number;

  @ApiProperty()
  format: string;

  @ApiProperty()
  size: number;

  @ApiProperty()
  alt: string;

  @ApiProperty()
  createdAt: Date;
}

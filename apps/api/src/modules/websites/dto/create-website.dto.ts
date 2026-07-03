import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsObject,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WebsiteStatus } from '@prisma/client';

export class CreateWebsiteDto {
  @ApiProperty({
    description: 'ID of the project this website belongs to',
    example: 'proj_abc123',
  })
  @IsUUID()
  projectId: string;

  @ApiProperty({
    description: 'Desired subdomain (e.g., "myblog")',
    example: 'myblog',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(63)
  subdomain: string;

  @ApiPropertyOptional({
    description: 'Custom domain name (e.g., "example.com")',
    example: 'example.com',
  })
  @IsOptional()
  @IsString()
  customDomain?: string;

  @ApiPropertyOptional({
    description: 'Website title / site name',
    example: 'My Awesome Blog',
  })
  @IsOptional()
  @IsString()
  siteTitle?: string;

  @ApiPropertyOptional({
    description: 'Website description / tagline',
    example: 'A blog about technology and innovation',
  })
  @IsOptional()
  @IsString()
  siteDescription?: string;

  @ApiPropertyOptional({
    description: 'URL to the site logo',
    example: 'https://storage.autoblog.ai/logos/my-logo.png',
  })
  @IsOptional()
  @IsString()
  siteLogo?: string;

  @ApiPropertyOptional({
    description: 'URL to the favicon',
    example: 'https://storage.autoblog.ai/favicons/my-favicon.ico',
  })
  @IsOptional()
  @IsString()
  favicon?: string;

  @ApiPropertyOptional({
    description: 'Google Analytics measurement ID',
    example: 'G-XXXXXXXXXX',
  })
  @IsOptional()
  @IsString()
  googleAnalyticsId?: string;

  @ApiPropertyOptional({
    description: 'Google Tag Manager container ID',
    example: 'GTM-XXXXXXX',
  })
  @IsOptional()
  @IsString()
  gtmId?: string;

  @ApiPropertyOptional({
    description: 'Theme ID to apply',
    example: 'theme_modern_blog',
  })
  @IsOptional()
  @IsString()
  themeId?: string;

  @ApiPropertyOptional({
    description: 'Initial theme configuration',
  })
  @IsOptional()
  @IsObject()
  themeConfig?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Initial status of the website',
    enum: WebsiteStatus,
    default: WebsiteStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(WebsiteStatus)
  status?: WebsiteStatus;
}

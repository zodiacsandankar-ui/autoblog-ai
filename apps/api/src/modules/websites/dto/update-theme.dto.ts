import {
  IsString,
  IsOptional,
  IsObject,
  IsHexColor,
  IsArray,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

class FontConfig {
  @IsOptional()
  @IsString()
  heading?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsNumber()
  baseSize?: number;
}

class LayoutConfig {
  @IsOptional()
  @IsString()
  containerWidth?: string;

  @IsOptional()
  @IsString()
  sidebarPosition?: 'left' | 'right' | 'none';

  @IsOptional()
  @IsNumber()
  sidebarWidth?: number;
}

export class UpdateThemeDto {
  @ApiPropertyOptional({
    description: 'Primary brand color (hex)',
    example: '#4F46E5',
  })
  @IsOptional()
  @IsString()
  primaryColor?: string;

  @ApiPropertyOptional({
    description: 'Secondary brand color (hex)',
    example: '#10B981',
  })
  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @ApiPropertyOptional({
    description: 'Background color (hex)',
    example: '#FFFFFF',
  })
  @IsOptional()
  @IsString()
  backgroundColor?: string;

  @ApiPropertyOptional({
    description: 'Text color (hex)',
    example: '#111827',
  })
  @IsOptional()
  @IsString()
  textColor?: string;

  @ApiPropertyOptional({
    description: 'Accent color (hex)',
    example: '#F59E0B',
  })
  @IsOptional()
  @IsString()
  accentColor?: string;

  @ApiPropertyOptional({
    description: 'Font configuration',
    type: FontConfig,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FontConfig)
  fonts?: FontConfig;

  @ApiPropertyOptional({
    description: 'Layout configuration',
    type: LayoutConfig,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LayoutConfig)
  layout?: LayoutConfig;

  @ApiPropertyOptional({
    description: 'Custom CSS overrides',
    example: '.site-header { background: #000; }',
  })
  @IsOptional()
  @IsString()
  customCss?: string;

  @ApiPropertyOptional({
    description: 'Raw theme config object (overrides all)',
  })
  @IsOptional()
  @IsObject()
  themeConfig?: Record<string, unknown>;
}

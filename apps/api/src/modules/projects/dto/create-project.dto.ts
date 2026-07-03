import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsObject,
  IsNumber,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectStatus } from '@prisma/client';

export class CreateProjectDto {
  @ApiProperty({
    description: 'Project name',
    example: 'My Tech Blog',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description: 'Project description',
    example: 'A blog about technology and software development',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Content language (BCP-47 tag)',
    example: 'en-US',
  })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    description: 'Target country for SEO',
    example: 'US',
  })
  @IsOptional()
  @IsString()
  targetCountry?: string;

  @ApiPropertyOptional({
    description: 'Default writing tone',
    example: 'professional',
  })
  @IsOptional()
  @IsString()
  tone?: string;

  @ApiPropertyOptional({
    description: 'Writing style guide',
    example: 'apa',
  })
  @IsOptional()
  @IsString()
  writingStyle?: string;

  @ApiPropertyOptional({
    description: 'Default article length in words',
    example: 1500,
  })
  @IsOptional()
  @IsNumber()
  articleLength?: number;

  @ApiPropertyOptional({
    description: 'Posting frequency (cron expression or human-readable)',
    example: '3x per week',
  })
  @IsOptional()
  @IsString()
  postingFrequency?: string;

  @ApiPropertyOptional({
    description: 'Timezone for scheduling',
    example: 'America/New_York',
  })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({
    description: 'Organization ID to associate the project with',
    example: 'org_abc123',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({
    description: 'Additional project settings',
    example: { autoGenerate: true, defaultCategory: 'tech' },
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Initial project status',
    enum: ProjectStatus,
    default: ProjectStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}

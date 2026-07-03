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
  IsDateString,
  IsNumber,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ScheduleFrequency {
  ONCE = 'once',
  HOURLY = 'hourly',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  BIWEEKLY = 'biweekly',
  MONTHLY = 'monthly',
  CUSTOM = 'custom',
}

export enum ScheduleStatus {
  PENDING = 'pending',
  SCHEDULED = 'scheduled',
  PUBLISHING = 'publishing',
  PUBLISHED = 'published',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export class ScheduleConfigDto {
  @ApiProperty({ description: 'Article ID to schedule' })
  @IsUUID()
  @IsNotEmpty()
  articleId: string;

  @ApiProperty({ description: 'Scheduled publish date/time (ISO 8601)' })
  @IsDateString()
  @IsNotEmpty()
  scheduledAt: string;

  @ApiPropertyOptional({ enum: ScheduleFrequency, default: ScheduleFrequency.ONCE })
  @IsOptional()
  @IsEnum(ScheduleFrequency)
  frequency?: ScheduleFrequency;

  @ApiPropertyOptional({ description: 'Cron expression for custom frequency' })
  @IsOptional()
  @IsString()
  cronExpression?: string;

  @ApiPropertyOptional({ description: 'Timezone (IANA format, e.g., America/New_York)', default: 'UTC' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ type: [String], description: 'Platforms to publish to' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platforms?: string[];

  @ApiPropertyOptional({ description: 'Post to social media', default: true })
  @IsOptional()
  @IsBoolean()
  socialPromotion?: boolean;

  @ApiPropertyOptional({ description: 'Send email notification', default: false })
  @IsOptional()
  @IsBoolean()
  emailNotification?: boolean;

  @ApiPropertyOptional({ description: 'Project ID' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Priority (0 = normal, 1 = high)', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1)
  priority?: number;
}

export class ScheduleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  articleId: string;

  @ApiProperty()
  articleTitle: string;

  @ApiProperty()
  scheduledAt: Date;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  frequency?: string;

  @ApiPropertyOptional()
  cronExpression?: string;

  @ApiProperty()
  timezone: string;

  @ApiProperty({ type: [String] })
  platforms: string[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class OptimalTimesQueryDto {
  @ApiProperty({ description: 'Project ID' })
  @IsUUID()
  @IsNotEmpty()
  projectId: string;

  @ApiPropertyOptional({ description: 'Timezone (IANA format)', default: 'UTC' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ description: 'Number of days to analyze', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  days?: number;
}

export class CalendarQueryDto {
  @ApiPropertyOptional({ description: 'Start date for calendar view' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date for calendar view' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;

  @ApiPropertyOptional({ description: 'Project ID' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

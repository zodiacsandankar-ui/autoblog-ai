import {
  IsString,
  IsOptional,
  IsUUID,
  IsEmail,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({
    description: 'Article ID this comment belongs to',
    example: 'art_abc123',
  })
  @IsUUID()
  articleId: string;

  @ApiPropertyOptional({
    description: 'Parent comment ID (for nested replies)',
    example: 'cmt_xyz789',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiProperty({
    description: 'Display name of the comment author',
    example: 'John Doe',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  authorName: string;

  @ApiProperty({
    description: 'Email of the comment author',
    example: 'john@example.com',
  })
  @IsEmail()
  @MaxLength(255)
  authorEmail: string;

  @ApiPropertyOptional({
    description: 'URL to the author\'s avatar',
    example: 'https://gravatar.com/avatar/abc123',
  })
  @IsOptional()
  @IsString()
  authorAvatar?: string;

  @ApiProperty({
    description: 'Comment content / body',
    example: 'Great article! Thanks for sharing.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;
}

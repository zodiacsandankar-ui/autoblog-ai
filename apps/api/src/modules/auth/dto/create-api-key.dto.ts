import {
  IsString,
  IsArray,
  IsOptional,
  IsDateString,
  MinLength,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({
    description: 'Human-readable name for this API key',
    example: 'Production CI/CD',
  })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({
    description: 'Permission scopes for this API key',
    example: ['articles:read', 'articles:write'],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1, { message: 'At least one scope is required' })
  scopes: string[];

  @ApiProperty({
    description: 'Optional expiration date (ISO 8601)',
    required: false,
    example: '2027-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

import { IsEmail, IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @ApiProperty({
    description: 'User password',
    example: 'SecurePass123!',
  })
  @IsString()
  password: string;

  @ApiProperty({
    description: 'Extend session lifetime (30 days vs 7 days)',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

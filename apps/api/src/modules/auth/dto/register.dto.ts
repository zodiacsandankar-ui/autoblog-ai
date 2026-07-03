import {
  IsEmail,
  IsString,
  MinLength,
  Matches,
  IsBoolean,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @ApiProperty({
    description:
      'Password (min 8 chars, must contain uppercase, lowercase, number, and special character)',
    example: 'SecurePass123!',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+={}[\]|:;"'<>,.?/~`])/,
    {
      message:
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
    },
  )
  password: string;

  @ApiProperty({
    description: 'User display name',
    example: 'John Doe',
  })
  @IsString()
  @MinLength(1, { message: 'Name is required' })
  name: string;

  @ApiProperty({
    description: 'Accept terms of service and privacy policy',
    example: true,
  })
  @IsBoolean()
  acceptTerms: boolean;
}

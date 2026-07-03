import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Redirect,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  // ───────────────────────────────────────────────────────────
  // Registration & Login
  // ───────────────────────────────────────────────────────────

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'User registered successfully' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Email already in use' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Validation failed' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate user and return tokens' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Login successful' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Headers('user-agent') userAgent?: string,
  ) {
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    return this.authService.login(dto, ipAddress, userAgent);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a new access token using a refresh token' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Token refreshed' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke session or all sessions' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Logged out successfully' })
  async logout(
    @CurrentUser('id') userId: string,
    @Body('sessionId') sessionId?: string,
  ) {
    await this.authService.logout(userId, sessionId || undefined);
    return { message: 'Logged out successfully' };
  }

  // ───────────────────────────────────────────────────────────
  // Email Verification
  // ───────────────────────────────────────────────────────────

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address with token' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Email verified' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid or expired token' })
  async verifyEmail(@Body('token') token: string) {
    await this.authService.verifyEmail(token);
    return { message: 'Email verified successfully' };
  }

  // ───────────────────────────────────────────────────────────
  // Password Management
  // ───────────────────────────────────────────────────────────

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Reset email sent if account exists' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return {
      message:
        'If an account with that email exists, a password reset link has been sent.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using a reset token' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Password reset successful' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid or expired token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password reset successful' };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password for authenticated user' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Password changed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Current password incorrect or validation failed' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(userId, dto.oldPassword, dto.newPassword);
    return { message: 'Password changed successfully' };
  }

  // ───────────────────────────────────────────────────────────
  // Multi-Factor Authentication
  // ───────────────────────────────────────────────────────────

  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set up multi-factor authentication (TOTP)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'MFA setup data returned' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'MFA already enabled' })
  async setupMfa(@CurrentUser('id') userId: string) {
    return this.authService.setupMfa(userId);
  }

  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify MFA code and enable MFA' })
  @ApiResponse({ status: HttpStatus.OK, description: 'MFA enabled' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid code' })
  async verifyMfa(
    @CurrentUser('id') userId: string,
    @Body() dto: VerifyMfaDto,
  ) {
    await this.authService.verifyMfa(userId, dto.code);
    return { message: 'MFA enabled successfully' };
  }

  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable MFA (requires valid code)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'MFA disabled' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid code or MFA not enabled' })
  async disableMfa(
    @CurrentUser('id') userId: string,
    @Body() dto: VerifyMfaDto,
  ) {
    await this.authService.disableMfa(userId, dto.code);
    return { message: 'MFA disabled successfully' };
  }

  // ───────────────────────────────────────────────────────────
  // Session Management
  // ───────────────────────────────────────────────────────────

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all active sessions for the current user' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Sessions retrieved' })
  async listSessions(@CurrentUser('id') userId: string) {
    return this.authService.listSessions(userId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a specific session' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Session revoked' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Session not found' })
  async revokeSession(
    @CurrentUser('id') userId: string,
    @Param('id') sessionId: string,
  ) {
    await this.authService.revokeSession(userId, sessionId);
    return { message: 'Session revoked successfully' };
  }

  // ───────────────────────────────────────────────────────────
  // API Key Management
  // ───────────────────────────────────────────────────────────

  @Post('api-keys')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a new API key' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'API key created (shown once)' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Validation failed' })
  async createApiKey(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.authService.generateApiKey(
      userId,
      dto.name,
      dto.scopes,
      dto.expiresAt,
    );
  }

  @Get('api-keys')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all active API keys for the current user' })
  @ApiResponse({ status: HttpStatus.OK, description: 'API keys retrieved' })
  async listApiKeys(@CurrentUser('id') userId: string) {
    return this.authService.listApiKeys(userId);
  }

  @Delete('api-keys/:id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiResponse({ status: HttpStatus.OK, description: 'API key revoked' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'API key not found' })
  async revokeApiKey(
    @CurrentUser('id') userId: string,
    @Param('id') keyId: string,
  ) {
    await this.authService.revokeApiKey(userId, keyId);
    return { message: 'API key revoked successfully' };
  }

  // ───────────────────────────────────────────────────────────
  // OAuth — Google
  // ───────────────────────────────────────────────────────────

  @Public()
  @Get('oauth/google')
  @Redirect()
  @ApiOperation({ summary: 'Redirect to Google OAuth consent screen' })
  @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirecting to Google...' })
  async googleAuth() {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const redirectUri = this.configService.get<string>('GOOGLE_CALLBACK_URL');
    const scope = 'email profile';

    if (!clientId || !redirectUri) {
      throw new Error('Google OAuth is not configured');
    }

    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;

    return { url };
  }

  @Public()
  @Get('oauth/google/callback')
  @ApiOperation({ summary: 'Google OAuth callback handler' })
  @ApiResponse({ status: HttpStatus.OK, description: 'OAuth login successful' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'OAuth failed' })
  async googleAuthCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Req() req: Request,
    @Headers('user-agent') userAgent?: string,
  ) {
    if (error) {
      throw new UnauthorizedException(`Google OAuth error: ${error}`);
    }

    if (!code) {
      throw new UnauthorizedException('Authorization code is required');
    }

    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('GOOGLE_CALLBACK_URL');

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('Google OAuth is not configured');
    }

    // Exchange code for tokens
    const tokenResponse = await axios.post(
      'https://oauth2.googleapis.com/token',
      {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      },
    );

    const { access_token } = tokenResponse.data;

    // Get user profile
    const profileResponse = await axios.get(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 10000,
      },
    );

    const profile = {
      id: profileResponse.data.id,
      email: profileResponse.data.email,
      name: profileResponse.data.name,
      avatar: profileResponse.data.picture,
    };

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    return this.authService.handleOAuthLogin('google', profile, ipAddress, userAgent);
  }

  // ───────────────────────────────────────────────────────────
  // OAuth — GitHub
  // ───────────────────────────────────────────────────────────

  @Public()
  @Get('oauth/github')
  @Redirect()
  @ApiOperation({ summary: 'Redirect to GitHub OAuth consent screen' })
  @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirecting to GitHub...' })
  async githubAuth() {
    const clientId = this.configService.get<string>('GITHUB_CLIENT_ID');
    const redirectUri = this.configService.get<string>('GITHUB_CALLBACK_URL');
    const scope = 'read:user user:email';

    if (!clientId || !redirectUri) {
      throw new Error('GitHub OAuth is not configured');
    }

    const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&prompt=consent`;

    return { url };
  }

  @Public()
  @Get('oauth/github/callback')
  @ApiOperation({ summary: 'GitHub OAuth callback handler' })
  @ApiResponse({ status: HttpStatus.OK, description: 'OAuth login successful' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'OAuth failed' })
  async githubAuthCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Req() req: Request,
    @Headers('user-agent') userAgent?: string,
  ) {
    if (error) {
      throw new UnauthorizedException(`GitHub OAuth error: ${error}`);
    }

    if (!code) {
      throw new UnauthorizedException('Authorization code is required');
    }

    const clientId = this.configService.get<string>('GITHUB_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GITHUB_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('GITHUB_CALLBACK_URL');

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('GitHub OAuth is not configured');
    }

    // Exchange code for access token
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 10000,
      },
    );

    const { access_token } = tokenResponse.data;

    if (!access_token) {
      throw new UnauthorizedException('Failed to obtain GitHub access token');
    }

    // Get user profile
    const profileResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 10000,
    });

    // Get primary email
    let email = profileResponse.data.email;
    if (!email) {
      const emailsResponse = await axios.get(
        'https://api.github.com/user/emails',
        {
          headers: { Authorization: `Bearer ${access_token}` },
          timeout: 10000,
        },
      );
      const primaryEmail = emailsResponse.data.find(
        (e: { primary: boolean }) => e.primary,
      );
      email = primaryEmail?.email || emailsResponse.data[0]?.email;
    }

    const profile = {
      id: String(profileResponse.data.id),
      email: email || `github_${profileResponse.data.id}@placeholder.com`,
      name: profileResponse.data.name || profileResponse.data.login,
      avatar: profileResponse.data.avatar_url,
    };

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    return this.authService.handleOAuthLogin('github', profile, ipAddress, userAgent);
  }
}

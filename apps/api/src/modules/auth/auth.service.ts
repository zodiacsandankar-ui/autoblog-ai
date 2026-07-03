import {
  Injectable,
  Logger,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/database/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import * as bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { User, UserRole, UserStatus, ApiKey } from '@prisma/client';
import { JwtPayload } from './jwt.strategy';

// ─────────────────────────────────────────────────────────────
// TOTP helpers (RFC 6238 — no external dependencies)
// ─────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random base32 TOTP secret.
 */
function generateTotpSecret(): string {
  const buffer = crypto.randomBytes(20);
  return base32Encode(buffer);
}

/**
 * Base32 encode (RFC 4648) without padding.
 */
function base32Encode(buffer: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 0x1f];
  }

  return output;
}

/**
 * Compute a TOTP code for the given secret and time window.
 */
function computeTotp(secret: string, window: number = 0): string {
  const counter = Math.floor(Date.now() / 30000) + window;
  const counterBuffer = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    counterBuffer[i] = counter & 0xff;
    counter >>= 8;
  }

  // Decode base32 secret
  const key = decodeBase32(secret);
  const hmac = crypto.createHmac('sha1', key);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  const offset = digest[digest.length - 1] & 0xf;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

/**
 * Verify a TOTP code against a secret, checking current and adjacent windows.
 */
function verifyTotp(secret: string, token: string): boolean {
  // Allow +/-1 window for clock drift
  for (let window = -1; window <= 1; window++) {
    if (computeTotp(secret, window) === token) {
      return true;
    }
  }
  return false;
}

/**
 * Decode a base32 string to a Buffer.
 */
function decodeBase32(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = input.replace(/[^A-Z2-7]/g, '').toUpperCase();
  const bits: number[] = [];

  for (const char of cleaned) {
    const val = alphabet.indexOf(char);
    if (val >= 0) {
      for (let i = 4; i >= 0; i--) {
        bits.push((val >> i) & 1);
      }
    }
  }

  const bytes: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | (bits[i + j] || 0);
    }
    bytes.push(byte);
  }

  return Buffer.from(bytes);
}

// ─────────────────────────────────────────────────────────────
// Auth Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly CACHE_PREFIX = {
    EMAIL_VERIFY: 'auth:email_verify:',
    PASSWORD_RESET: 'auth:password_reset:',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cache: CacheService,
  ) {}

  // ───────────────────────────────────────────────────────────
  // Helper Methods
  // ───────────────────────────────────────────────────────────

  /**
   * Remove sensitive fields from user object.
   */
  private sanitizeUser(
    user: User,
  ): Omit<User, 'passwordHash' | 'twoFactorSecret'> {
    const { passwordHash, twoFactorSecret, ...sanitized } = user;
    return sanitized;
  }

  /**
   * Generate access and refresh tokens for a user.
   */
  private async generateTokens(
    user: User,
    rememberMe: boolean = false,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = uuidv4();
    const sessionDuration = rememberMe ? 30 : 7; // days
    const expiresAt = new Date(
      Date.now() + sessionDuration * 24 * 60 * 60 * 1000,
    );

    // Store session in database
    await this.prisma.session.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });

    return { accessToken, refreshToken, expiresAt };
  }

  // ───────────────────────────────────────────────────────────
  // Registration & Authentication
  // ───────────────────────────────────────────────────────────

  /**
   * Register a new user account.
   */
  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcryptjs.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        status: UserStatus.PENDING,
        emailVerified: false,
      },
    });

    // Generate email verification token (24h expiry)
    const verificationToken = uuidv4();
    await this.cache.set(
      `${this.CACHE_PREFIX.EMAIL_VERIFY}${verificationToken}`,
      user.id,
      86400, // 24 hours
    );

    // In production, this would send an email via Queue/Notifications module.
    // The email would contain a link like: /auth/verify-email?token=...
    this.logger.log(
      `[EMAIL] Verification email sent to ${user.email} with token: ${verificationToken}`,
    );

    return {
      user: this.sanitizeUser(user),
      message:
        'Registration successful. Please check your email to verify your account.',
      verificationToken, // exposed for dev/testing; remove in production
    };
  }

  /**
   * Authenticate a user and issue tokens.
   */
  async login(
    dto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcryptjs.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.deletedAt) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException(
        'This account has been suspended. Contact support.',
      );
    }

    if (user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException('This account is inactive');
    }

    // Check if MFA is enabled — return a partial response requiring MFA verification
    if (user.twoFactorEnabled) {
      const mfaToken = uuidv4();
      await this.cache.set(
        `auth:mfa_session:${mfaToken}`,
        { userId: user.id, expiresAt: Date.now() + 300000 }, // 5 min
        300,
      );

      return {
        requiresMfa: true,
        mfaToken,
        message: 'MFA code required to complete login',
      };
    }

    // Update last login
    await this.prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch((err) =>
        this.logger.warn(`Failed to update last login: ${(err as Error).message}`),
      );

    const tokens = await this.generateTokens(user, dto.rememberMe, ipAddress, userAgent);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * Validate a user's credentials (used by local strategy).
   */
  async validateUser(
    email: string,
    password: string,
  ): Promise<Omit<User, 'passwordHash' | 'twoFactorSecret'> | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) return null;
    if (user.deletedAt) return null;
    if (user.status !== UserStatus.ACTIVE) return null;

    const isPasswordValid = await bcryptjs.compare(password, user.passwordHash);
    if (!isPasswordValid) return null;

    return this.sanitizeUser(user);
  }

  // ───────────────────────────────────────────────────────────
  // Token Management
  // ───────────────────────────────────────────────────────────

  /**
   * Issue a new access token using a refresh token.
   */
  async refreshToken(refreshToken: string) {
    const session = await this.prisma.session.findUnique({
      where: { token: refreshToken },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.expiresAt < new Date()) {
      // Delete expired session
      await this.prisma.session
        .delete({ where: { id: session.id } })
        .catch(() => {});
      throw new UnauthorizedException('Refresh token has expired');
    }

    if (session.user.deletedAt) {
      throw new UnauthorizedException('Account has been deactivated');
    }

    if (session.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account is not active');
    }

    // Issue new access token
    const payload: JwtPayload = {
      sub: session.user.id,
      email: session.user.email,
      role: session.user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: session.user,
    };
  }

  /**
   * Log out a user by revoking a specific session.
   */
  async logout(userId: string, sessionId?: string): Promise<void> {
    if (sessionId) {
      // Revoke specific session
      await this.prisma.session.deleteMany({
        where: {
          id: sessionId,
          userId,
        },
      });
      this.logger.log(`Session ${sessionId} revoked for user ${userId}`);
    } else {
      // Revoke all sessions for this user
      const deleted = await this.prisma.session.deleteMany({
        where: { userId },
      });
      this.logger.log(
        `All sessions revoked for user ${userId} (${deleted.count} sessions)`,
      );
    }
  }

  // ───────────────────────────────────────────────────────────
  // Email Verification
  // ───────────────────────────────────────────────────────────

  /**
   * Verify a user's email address using a verification token.
   */
  async verifyEmail(token: string): Promise<void> {
    const userId = await this.cache.get<string>(
      `${this.CACHE_PREFIX.EMAIL_VERIFY}${token}`,
    );

    if (!userId) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerified: true,
        status: UserStatus.ACTIVE,
      },
    });

    // Delete the used token
    await this.cache.del(`${this.CACHE_PREFIX.EMAIL_VERIFY}${token}`);

    this.logger.log(`Email verified for user ${userId}`);
  }

  // ───────────────────────────────────────────────────────────
  // Password Management
  // ───────────────────────────────────────────────────────────

  /**
   * Generate a password reset token and "send" the reset email.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Don't reveal whether the email exists
    if (!user) {
      return;
    }

    const resetToken = uuidv4();
    await this.cache.set(
      `${this.CACHE_PREFIX.PASSWORD_RESET}${resetToken}`,
      user.id,
      3600, // 1 hour
    );

    // In production, this would send an email via Queue/Notifications module.
    this.logger.log(
      `[EMAIL] Password reset email sent to ${email} with token: ${resetToken}`,
    );
  }

  /**
   * Reset a password using a reset token.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await this.cache.get<string>(
      `${this.CACHE_PREFIX.PASSWORD_RESET}${token}`,
    );

    if (!userId) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const passwordHash = await bcryptjs.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Delete the used token
    await this.cache.del(`${this.CACHE_PREFIX.PASSWORD_RESET}${token}`);

    // Revoke all existing sessions for security
    await this.prisma.session.deleteMany({
      where: { userId },
    });

    this.logger.log(`Password reset completed for user ${userId}`);
  }

  /**
   * Change password for an authenticated user.
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isOldPasswordValid = await bcryptjs.compare(
      oldPassword,
      user.passwordHash,
    );
    if (!isOldPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await bcryptjs.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    this.logger.log(`Password changed for user ${userId}`);
  }

  // ───────────────────────────────────────────────────────────
  // Multi-Factor Authentication (TOTP)
  // ───────────────────────────────────────────────────────────

  /**
   * Set up MFA by generating a TOTP secret and returning the provisioning URI.
   * MFA is not enabled until the user verifies the first code.
   */
  async setupMfa(
    userId: string,
  ): Promise<{ secret: string; qrCodeUrl: string; backupCodes?: string[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.twoFactorEnabled) {
      throw new BadRequestException('MFA is already enabled. Disable it first to reconfigure.');
    }

    const secret = generateTotpSecret();
    const appName = this.configService.get<string>('APP_NAME', 'AutoBlog AI');
    const qrCodeUrl = `otpauth://totp/${encodeURIComponent(appName)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(appName)}&algorithm=SHA1&digits=6&period=30`;

    // Store the new secret temporarily (not yet enabled)
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret },
    });

    this.logger.log(`MFA setup initiated for user ${userId}`);

    return {
      secret,
      qrCodeUrl,
    };
  }

  /**
   * Verify a TOTP code and enable MFA for the user.
   */
  async verifyMfa(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.twoFactorEnabled) {
      throw new BadRequestException('MFA is already enabled');
    }

    if (!user.twoFactorSecret) {
      throw new BadRequestException(
        'MFA has not been set up. Call setupMfa first.',
      );
    }

    const isValid = verifyTotp(user.twoFactorSecret, code);
    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    this.logger.log(`MFA enabled for user ${userId}`);
  }

  /**
   * Verify MFA during login (second factor).
   */
  async verifyMfaLogin(
    mfaToken: string,
    code: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const session = await this.cache.get<{
      userId: string;
      expiresAt: number;
    }>(`auth:mfa_session:${mfaToken}`);

    if (!session) {
      throw new UnauthorizedException('Invalid or expired MFA session');
    }

    if (session.expiresAt < Date.now()) {
      await this.cache.del(`auth:mfa_session:${mfaToken}`);
      throw new UnauthorizedException('MFA session has expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.twoFactorSecret || !user.twoFactorEnabled) {
      throw new BadRequestException('MFA is not configured for this account');
    }

    const isValid = verifyTotp(user.twoFactorSecret, code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    // Clean up MFA session
    await this.cache.del(`auth:mfa_session:${mfaToken}`);

    // Update last login
    await this.prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch((err) =>
        this.logger.warn(`Failed to update last login: ${(err as Error).message}`),
      );

    const tokens = await this.generateTokens(user, false, ipAddress, userAgent);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * Disable MFA for a user (requires current valid code).
   */
  async disableMfa(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.twoFactorEnabled) {
      throw new BadRequestException('MFA is not currently enabled');
    }

    if (!user.twoFactorSecret) {
      throw new BadRequestException('MFA secret not found');
    }

    const isValid = verifyTotp(user.twoFactorSecret, code);
    if (!isValid) {
      throw new BadRequestException('Invalid MFA code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
      },
    });

    this.logger.log(`MFA disabled for user ${userId}`);
  }

  // ───────────────────────────────────────────────────────────
  // API Key Management
  // ───────────────────────────────────────────────────────────

  /**
   * Generate a new scoped API key.
   * Returns the full key only once — it will not be stored in plaintext.
   */
  async generateApiKey(
    userId: string,
    name: string,
    scopes: string[],
    expiresAt?: string,
  ): Promise<{
    apiKey: { id: string; name: string; prefix: string; scopes: string[]; expiresAt: Date | null; createdAt: Date };
    rawKey: string;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Generate a key in format: autoblog_{prefix}_{secret}
    const keyPrefix = `autoblog_${uuidv4().substring(0, 8)}`;
    const keySecret = uuidv4().replace(/-/g, '') + crypto.randomBytes(16).toString('hex');
    const rawKey = `${keyPrefix}_${keySecret}`;

    const keyHash = await bcryptjs.hash(rawKey, 10);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        userId,
        name,
        keyHash,
        keyPrefix,
        scopes,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    this.logger.log(`API key generated for user ${userId}: ${name}`);

    return {
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.keyPrefix,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
      },
      rawKey, // Only returned once — store it securely
    };
  }

  /**
   * Revoke an API key by setting its revokedAt timestamp.
   */
  async revokeApiKey(userId: string, keyId: string): Promise<void> {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id: keyId, userId },
    });

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    if (apiKey.revokedAt) {
      throw new BadRequestException('API key is already revoked');
    }

    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`API key ${keyId} revoked for user ${userId}`);
  }

  /**
   * List all non-revoked API keys for a user.
   */
  async listApiKeys(
    userId: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      keyPrefix: string;
      scopes: string[];
      lastUsedAt: Date | null;
      expiresAt: Date | null;
      createdAt: Date;
      isExpired: boolean;
    }>
  > {
    const apiKeys = await this.prisma.apiKey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    return apiKeys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: key.scopes,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
      isExpired: key.expiresAt ? key.expiresAt < new Date() : false,
    }));
  }

  // ───────────────────────────────────────────────────────────
  // Session Management
  // ───────────────────────────────────────────────────────────

  /**
   * List all active sessions for a user.
   */
  async listSessions(
    userId: string,
  ): Promise<
    Array<{
      id: string;
      createdAt: Date;
      expiresAt: Date;
      ipAddress: string | null;
      userAgent: string | null;
      isCurrent: boolean;
    }>
  > {
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      isCurrent: false, // Controller will set this based on request
    }));
  }

  /**
   * Revoke a specific session.
   */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    await this.prisma.session.delete({
      where: { id: sessionId },
    });

    this.logger.log(`Session ${sessionId} revoked for user ${userId}`);
  }

  // ───────────────────────────────────────────────────────────
  // OAuth
  // ───────────────────────────────────────────────────────────

  /**
   * Handle OAuth login (Google/GitHub).
   * Finds or creates a user based on OAuth profile data.
   */
  async handleOAuthLogin(
    provider: 'google' | 'github',
    profile: {
      id: string;
      email: string;
      name: string;
      avatar?: string;
    },
    ipAddress?: string,
    userAgent?: string,
  ) {
    // Try to find existing user by email
    let user = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });

    if (user) {
      // Existing user — if they were not email-verified, mark them as such
      if (!user.emailVerified) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: true, lastLoginAt: new Date() },
        });
      } else {
        await this.prisma.user
          .update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          })
          .catch(() => {});
      }
    } else {
      // New user — create account
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          name: profile.name || provider + '_user',
          passwordHash: await bcryptjs.hash(uuidv4(), 12), // Random password (OAuth users login via OAuth)
          avatar: profile.avatar,
          emailVerified: true, // OAuth emails are pre-verified
          status: UserStatus.ACTIVE,
        },
      });
      this.logger.log(
        `New user created via ${provider} OAuth: ${user.id} (${user.email})`,
      );
    }

    const tokens = await this.generateTokens(user, false, ipAddress, userAgent);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      user: this.sanitizeUser(user),
    };
  }
}

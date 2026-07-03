import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-http-bearer';
import * as bcryptjs from 'bcryptjs';
import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  private readonly logger = new Logger(ApiKeyStrategy.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async validate(apiKey: string): Promise<{ id: string; email: string; role: string; apiKeyId: string }> {
    try {
      // Extract prefix from the key (format: "autoblog_{prefix}_{secret}")
      const prefix = apiKey.split('_').slice(0, 2).join('_');

      // Find API keys matching this prefix
      const apiKeys = await this.prisma.apiKey.findMany({
        where: {
          keyPrefix: prefix,
          revokedAt: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
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

      // Try to find a matching key by comparing the hash
      for (const key of apiKeys) {
        const isValid = await bcryptjs.compare(apiKey, key.keyHash);
        if (isValid) {
          // Update last used timestamp (non-blocking)
          this.prisma.apiKey
            .update({
              where: { id: key.id },
              data: { lastUsedAt: new Date() },
            })
            .catch((err) =>
              this.logger.warn(`Failed to update API key usage: ${(err as Error).message}`),
            );

          const user = key.user;

          if (user.deletedAt) {
            throw new UnauthorizedException('Account has been deactivated');
          }

          if (user.status !== 'ACTIVE') {
            throw new UnauthorizedException('Account is not active');
          }

          return {
            id: user.id,
            email: user.email,
            role: user.role,
            apiKeyId: key.id,
          };
        }
      }

      throw new UnauthorizedException('Invalid API key');
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error('API key validation error', (error as Error).message);
      throw new UnauthorizedException('Invalid API key');
    }
  }
}

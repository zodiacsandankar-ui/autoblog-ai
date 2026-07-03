import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '@/database/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'super-secret-jwt-key'),
      passReqToCallback: false,
    });
  }

  async validate(payload: JwtPayload): Promise<{ id: string; email: string; role: string }> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          emailVerified: true,
          deletedAt: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

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
      };
    } catch (error) {
      this.logger.warn(`JWT validation failed for user ${payload.sub}: ${(error as Error).message}`);
      throw error instanceof UnauthorizedException
        ? error
        : new UnauthorizedException('Invalid token');
    }
  }
}

import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check if the route is marked as public (skip authentication)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest(err: Error | null, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      if (info) {
        const message =
          info.name === 'TokenExpiredError'
            ? 'Token has expired'
            : info.name === 'JsonWebTokenError'
              ? 'Invalid token'
              : 'Authentication required';

        this.logger.warn(`Auth failed: ${message}`);
        throw new UnauthorizedException(message);
      }

      throw err || new UnauthorizedException('Authentication required');
    }

    return user;
  }
}

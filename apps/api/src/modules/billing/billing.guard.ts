import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BillingService } from './billing.service';

export const CHECK_LIMITS_KEY = 'checkLimits';

/**
 * Guard that checks subscription plan limits before allowing access to a route.
 * Attach the @CheckLimits decorator (or set metadata manually) to specify which
 * feature limit to enforce.
 */
@Injectable()
export class BillingGuard implements CanActivate {
  private readonly logger = new Logger(BillingGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly billingService: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string>(CHECK_LIMITS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No limit check required for this route
    if (!feature) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // Resolve organization ID from the request
    const organizationId: string =
      request.params.organizationId ||
      request.body.organizationId ||
      request.query.organizationId ||
      user.organizationId;

    if (!organizationId) {
      throw new ForbiddenException('Organization not identified');
    }

    try {
      await this.billingService.checkLimits(organizationId, feature);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(
        `Billing guard check failed for org=${organizationId}, feature=${feature}: ${error.message}`,
      );
      throw new ForbiddenException(
        `Plan limit exceeded for feature: ${feature}. Please upgrade your plan.`,
      );
    }
  }
}

/**
 * Decorator that marks a route to check a specific billing limit.
 *
 * @example
 * @CheckLimits('articles')
 * @Post('articles')
 * async createArticle() { ... }
 */
export const CheckLimits = (feature: string) =>
  SetMetadata(CHECK_LIMITS_KEY, feature);

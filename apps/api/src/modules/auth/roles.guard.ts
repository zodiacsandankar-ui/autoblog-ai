import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      this.logger.warn('RolesGuard: No user found in request');
      throw new ForbiddenException('Authentication required');
    }

    const userRole = user.role as UserRole;

    // SUPER_ADMIN has access to everything
    if (userRole === UserRole.SUPER_ADMIN) {
      return true;
    }

    const hasRole = requiredRoles.includes(userRole);

    if (!hasRole) {
      this.logger.warn(
        `Access denied: User ${user.id} with role ${userRole} tried to access route requiring roles [${requiredRoles.join(', ')}]`,
      );
      throw new ForbiddenException(
        `Access denied. Required role: ${requiredRoles.join(' or ')}`,
      );
    }

    return true;
  }
}

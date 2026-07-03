import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PERMISSIONS_KEY } from './permissions.decorator';

/**
 * Role-to-permission mapping.
 * Defines which permissions each role inherently has.
 * SUPER_ADMIN has all permissions ('*').
 */
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  [UserRole.USER]: [
    'profile:read',
    'profile:update',
    'articles:read',
    'articles:write',
    'keywords:read',
    'trends:read',
    'images:read',
    'images:write',
  ],
  [UserRole.ADMIN]: [
    'profile:read',
    'profile:update',
    'users:read',
    'articles:*',
    'keywords:*',
    'trends:*',
    'images:*',
    'analytics:read',
    'organizations:read',
    'organizations:write',
  ],
  [UserRole.SUPER_ADMIN]: ['*'], // Wildcard — all permissions
};

/**
 * Checks if a set of user permissions satisfies the required permissions.
 * A '*' wildcard grants all permissions.
 */
function hasPermission(
  userPermissions: string[],
  requiredPermission: string,
): boolean {
  // Wildcard check
  if (userPermissions.includes('*')) return true;

  // Exact match
  if (userPermissions.includes(requiredPermission)) return true;

  // Wildcard segment match: e.g., 'articles:*' matches 'articles:read'
  const [requiredResource, requiredAction] = requiredPermission.split(':');
  for (const perm of userPermissions) {
    const [permResource, permAction] = perm.split(':');
    if (permResource === requiredResource && permAction === '*') return true;
  }

  return false;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permissions are required, allow access
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      this.logger.warn('PermissionsGuard: No user found in request');
      throw new ForbiddenException('Authentication required');
    }

    // Get permissions for the user's role
    const userRole = user.role as UserRole;
    const userPermissions = ROLE_PERMISSIONS[userRole] || [];

    // Check each required permission
    const allGranted = requiredPermissions.every((permission) =>
      hasPermission(userPermissions, permission),
    );

    if (!allGranted) {
      this.logger.warn(
        `Permission denied: User ${user.id} with role ${userRole} missing required permissions [${requiredPermissions.join(', ')}]`,
      );
      throw new ForbiddenException(
        `Insufficient permissions. Required: ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }
}

import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Decorator that specifies which roles are allowed to access a route.
 *
 * @example
 * @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
 * @Get('admin-only')
 * async adminEndpoint() { ... }
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

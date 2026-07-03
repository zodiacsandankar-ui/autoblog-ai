import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator that specifies which granular permissions are required to access a route.
 * All listed permissions must be present for access to be granted.
 *
 * @example
 * @Permissions('articles:read', 'articles:write')
 * @Get('articles')
 * async getArticles() { ... }
 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

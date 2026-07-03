import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator that marks a route as publicly accessible (no JWT authentication required).
 *
 * @example
 * @Public()
 * @Get('health')
 * async healthCheck() { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

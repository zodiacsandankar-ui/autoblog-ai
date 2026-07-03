import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client';

export interface JwtUser {
  id: string;
  email: string;
  role: string;
  [key: string]: unknown;
}

/**
 * Extracts the authenticated user from the request.
 * If a field name is provided, returns only that field.
 *
 * @example
 * // Get the full user object
 * @CurrentUser() user: JwtUser
 *
 * // Get only the user ID
 * @CurrentUser('id') userId: string
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext): JwtUser | string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as JwtUser | undefined;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);

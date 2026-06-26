import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * CurrentUser decorator
 *
 * Extracts the full user object from the JWT payload.
 * Usage: @CurrentUser() user: JwtPayload
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

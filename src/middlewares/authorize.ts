import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../shared/errors';
import type { Role } from '../generated/prisma/enums';

export function authorize(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError('No tienes permisos para realizar esta acción');
    }

    next();
  };
}

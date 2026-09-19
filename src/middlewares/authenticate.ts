import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UnauthorizedError } from '../shared/errors';
import type { Role } from '../generated/prisma/enums';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Token de acceso requerido');
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload & {
      typ?: string;
    };
    // Los tokens de cliente se firman con el mismo secreto: sin este chequeo, un cliente
    // podría usar su token en rutas del dashboard. Un token de staff nunca lleva `typ`.
    if (payload.typ !== undefined || !payload.role) {
      throw new Error('Token no es de staff');
    }
    req.user = { sub: payload.sub, role: payload.role };
    next();
  } catch {
    throw new UnauthorizedError('Token de acceso inválido o expirado');
  }
}

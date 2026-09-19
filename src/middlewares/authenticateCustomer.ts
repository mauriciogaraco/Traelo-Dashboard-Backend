import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../shared/errors';
import { verifyCustomerAccessToken } from '../modules/customer-auth/customer-token.service';

export interface AuthenticatedCustomer {
  id: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      customer?: AuthenticatedCustomer;
    }
  }
}

// Devuelve null si no hay header Authorization; lanza 401 si hay uno pero no sirve. Un token
// vencido NO se degrada a "invitado" en silencio: la app debe refrescar y reintentar, o el
// pedido quedaría sin vincular a la cuenta sin que nadie se entere.
function resolveCustomer(req: Request): AuthenticatedCustomer | null {
  const header = req.headers.authorization;
  if (!header) {
    return null;
  }
  if (!header.startsWith('Bearer ')) {
    throw new UnauthorizedError('Token de acceso inválido', 'INVALID_TOKEN');
  }

  const result = verifyCustomerAccessToken(header.slice('Bearer '.length));
  if (!result.ok) {
    throw result.reason === 'expired'
      ? new UnauthorizedError('Token de acceso expirado', 'TOKEN_EXPIRED')
      : new UnauthorizedError('Token de acceso inválido', 'INVALID_TOKEN');
  }
  return { id: result.customerId };
}

export function authenticateCustomer(req: Request, _res: Response, next: NextFunction): void {
  const customer = resolveCustomer(req);
  if (!customer) {
    throw new UnauthorizedError('Inicia sesión para continuar', 'AUTH_REQUIRED');
  }
  req.customer = customer;
  next();
}

// Para rutas abiertas a invitados (checkout): con Bearer válido identifica al cliente; sin
// header sigue como invitado. La identidad SIEMPRE sale del token, nunca del body/URL.
export function optionalCustomerAuth(req: Request, _res: Response, next: NextFunction): void {
  const customer = resolveCustomer(req);
  if (customer) {
    req.customer = customer;
  }
  next();
}

// "/customers/me/..." es un alias de "/customers/<mi id>/...": se reescribe la URL relativa
// al router para que las rutas existentes (y sus validaciones) funcionen sin cambios.
export function resolveMeAlias(req: Request, _res: Response, next: NextFunction): void {
  if (req.customer && /^\/me(?=[/?]|$)/.test(req.url)) {
    req.url = req.url.replace(/^\/me/, `/${req.customer.id}`);
  }
  next();
}

// Un cliente solo puede operar sobre SU propio id (IDOR): con :id explícito debe coincidir
// con el del token.
export function assertOwnCustomerId(req: Request, _res: Response, next: NextFunction): void {
  const { id } = req.params as { id?: string };
  if (!req.customer || id !== req.customer.id) {
    throw new ForbiddenError('No autorizado', 'CUSTOMER_MISMATCH');
  }
  next();
}

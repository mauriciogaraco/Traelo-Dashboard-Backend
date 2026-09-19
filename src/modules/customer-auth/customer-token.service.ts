import jwt from 'jsonwebtoken';
import ms from 'ms';
import { env } from '../../config/env';
import { generateRefreshToken, hashToken } from '../auth/token.service';

// El access token de cliente comparte secreto con el del staff, así que la separación entre
// ambos es el claim `typ`: el token de cliente lleva 'customer' y `authenticate` (staff) lo
// rechaza; a la inversa, `authenticateCustomer` exige ese claim y rechaza cualquier token de
// staff. Sin este claim, un cliente podría presentar su token en rutas de staff (o al revés).
export const CUSTOMER_TOKEN_TYPE = 'customer';

export interface CustomerAccessTokenPayload {
  sub: string;
  typ: typeof CUSTOMER_TOKEN_TYPE;
}

// Ventana en la que un refresh token ya rotado sigue siendo válido: si la respuesta del
// refresh se pierde (mala conexión), el reintento con el token viejo no debe cerrar la sesión.
export const REFRESH_ROTATION_GRACE_MS = 2 * 60 * 1000;

export function signCustomerAccessToken(customerId: string): string {
  const payload: CustomerAccessTokenPayload = { sub: customerId, typ: CUSTOMER_TOKEN_TYPE };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export type CustomerTokenVerification =
  { ok: true; customerId: string } | { ok: false; reason: 'expired' | 'invalid' };

export function verifyCustomerAccessToken(token: string): CustomerTokenVerification {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (
      typeof payload === 'string' ||
      payload.typ !== CUSTOMER_TOKEN_TYPE ||
      typeof payload.sub !== 'string'
    ) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, customerId: payload.sub };
  } catch (error) {
    return { ok: false, reason: error instanceof jwt.TokenExpiredError ? 'expired' : 'invalid' };
  }
}

export function accessTokenLifetimeSeconds(): number {
  return Math.floor(ms(env.JWT_ACCESS_EXPIRES_IN as ms.StringValue) / 1000);
}

export function customerRefreshTokenExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + ms(env.CUSTOMER_REFRESH_EXPIRES_IN as ms.StringValue));
}

export { generateRefreshToken, hashToken };

import type { Request, Response } from 'express';
import rateLimit, { type Options, type RateLimitRequestHandler } from 'express-rate-limit';

// Límites propios de la autenticación de clientes, aparte de publicRateLimit (60 req/min por
// IP para todo lo público). En Cuba muchas personas comparten una misma IP (NAT del
// operador), así que los límites por IP son holgados y el freno fuerte va por teléfono
// (la cuenta que se intenta adivinar). Los contadores viven en memoria del proceso: valen
// para una sola instancia (Render, hoy); con varias habría que mover el store a Redis/DB.
//
// Compromiso conocido: el límite por teléfono permite a un tercero bloquear 15 min el login de
// un número ajeno enviando intentos fallidos. Es preferible a permitir adivinar contraseñas
// sin tope; la contraseña correcta desde otro teléfono/IP igual queda bloqueada solo para ese
// número, no para la app entera.

export interface CustomerAuthLimiters {
  loginByIp: RateLimitRequestHandler;
  loginByPhone: RateLimitRequestHandler;
  register: RateLimitRequestHandler;
  refresh: RateLimitRequestHandler;
  recoveryByIp: RateLimitRequestHandler;
  recoveryByPhone: RateLimitRequestHandler;
}

export interface LimiterConfig {
  windowMs: number;
  limit: number;
}

export type CustomerAuthLimits = Record<keyof CustomerAuthLimiters, LimiterConfig>;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const DEFAULT_CUSTOMER_AUTH_LIMITS: CustomerAuthLimits = {
  loginByIp: { windowMs: 15 * MINUTE, limit: 30 },
  loginByPhone: { windowMs: 15 * MINUTE, limit: 5 },
  register: { windowMs: HOUR, limit: 10 },
  refresh: { windowMs: 15 * MINUTE, limit: 100 },
  recoveryByIp: { windowMs: HOUR, limit: 10 },
  recoveryByPhone: { windowMs: HOUR, limit: 3 },
};

function tooManyRequests(_req: Request, res: Response): void {
  res.status(429).json({
    error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
    code: 'RATE_LIMITED',
  });
}

// Las rutas ya pasaron por `validate`, así que body.phone llega normalizado.
function phoneKey(req: Request): string {
  const phone = (req.body as { phone?: unknown } | undefined)?.phone;
  return `phone:${typeof phone === 'string' ? phone : 'unknown'}`;
}

function build(config: LimiterConfig, extra: Partial<Options> = {}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: tooManyRequests,
    ...extra,
  });
}

export function buildCustomerAuthLimiters(
  limits: CustomerAuthLimits = DEFAULT_CUSTOMER_AUTH_LIMITS,
): CustomerAuthLimiters {
  return {
    // Solo cuentan los intentos fallidos: un login correcto no consume cupo.
    loginByIp: build(limits.loginByIp, { skipSuccessfulRequests: true }),
    loginByPhone: build(limits.loginByPhone, {
      skipSuccessfulRequests: true,
      keyGenerator: phoneKey,
    }),
    register: build(limits.register),
    refresh: build(limits.refresh),
    recoveryByIp: build(limits.recoveryByIp),
    recoveryByPhone: build(limits.recoveryByPhone, { keyGenerator: phoneKey }),
  };
}

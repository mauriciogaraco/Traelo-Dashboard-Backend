import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { ForbiddenError } from '../shared/errors';

function timingSafeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

// Barrera básica para las rutas públicas de catálogo/app (Fase 2): valida que la request
// traiga la API key de la app oficial en el header X-Api-Key. NO identifica a un cliente ni
// es autenticación real (eso es el flujo OTP, tarea aparte) — solo evita scraping trivial
// del catálogo por quien no tiene la app. Si el servidor no tiene MOBILE_APP_API_KEY
// configurada, estas rutas quedan cerradas (403) en vez de abiertas por defecto.
export function apiKeyAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!env.MOBILE_APP_API_KEY) {
    throw new ForbiddenError('MOBILE_APP_API_KEY no está configurada en el servidor');
  }

  const providedKey = req.header('x-api-key');
  if (!providedKey || !timingSafeCompare(providedKey, env.MOBILE_APP_API_KEY)) {
    throw new ForbiddenError('API key inválida o faltante');
  }

  next();
}

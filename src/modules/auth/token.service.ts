import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import ms from 'ms';
import { env } from '../../config/env';
import type { Role } from '../../generated/prisma/enums';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiresAt(): Date {
  const durationMs = ms(env.JWT_REFRESH_EXPIRES_IN as ms.StringValue);
  return new Date(Date.now() + durationMs);
}

export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

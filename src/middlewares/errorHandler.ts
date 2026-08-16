import type { NextFunction, Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../shared/errors';
import { logger } from '../shared/logger';

const PRISMA_ERROR_STATUS: Record<string, number> = {
  P2002: 409, // unique constraint violation
  P2003: 409, // foreign key constraint violation
  P2025: 404, // record not found
};

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, details: err.details });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Datos inválidos', details: z.treeifyError(err) });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const status = PRISMA_ERROR_STATUS[err.code] ?? 400;
    res.status(status).json({ error: 'Error de base de datos', details: { code: err.code } });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({ error: 'Error interno del servidor' });
}

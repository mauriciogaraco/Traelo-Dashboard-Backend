import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from './errors';
import { Role } from '../generated/prisma/enums';
import { prisma } from './prisma';

/**
 * Devuelve el negocio que administra un usuario BUSINESS_OWNER. Se lee de la base en cada
 * request (no del JWT): si a la cuenta se le cambia el negocio o se desactiva, el efecto es
 * inmediato en vez de esperar a que venza el token.
 */
export async function resolveOwnerBusinessId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, active: true, businessId: true },
  });

  if (!user || !user.active || user.role !== Role.BUSINESS_OWNER || !user.businessId) {
    throw new ForbiddenError('Tu cuenta no está asociada a ningún negocio', 'NO_BUSINESS_ASSIGNED');
  }

  return user.businessId;
}

/**
 * Para rutas `/businesses/:id/...` que también puede usar un dueño de negocio: al personal de
 * Tráelo (OWNER/ADMIN/EMPLOYEE) no lo restringe, pero un BUSINESS_OWNER solo puede operar sobre
 * SU negocio — cualquier otro `:id` es 403, aunque el rol esté permitido en la ruta.
 */
export async function restrictBusinessOwnerToOwnBusiness(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  if (req.user.role !== Role.BUSINESS_OWNER) {
    next();
    return;
  }

  const ownBusinessId = await resolveOwnerBusinessId(req.user.sub);
  const requestedBusinessId = (req.params as { id?: string }).id;

  if (requestedBusinessId !== ownBusinessId) {
    throw new ForbiddenError('No tenés acceso a este negocio', 'FORBIDDEN_BUSINESS');
  }

  next();
}

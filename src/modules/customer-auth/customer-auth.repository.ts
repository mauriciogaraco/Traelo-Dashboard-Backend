import { prisma } from '../../shared/prisma';

export function findCustomerByPhone(phone: string) {
  return prisma.customer.findUnique({ where: { phone } });
}

export function findCustomerById(id: string) {
  return prisma.customer.findUnique({ where: { id } });
}

export function countOrdersOfCustomer(customerId: string) {
  return prisma.order.count({ where: { customerId } });
}

export function createCustomerWithPassword(data: {
  name: string;
  phone: string;
  email?: string;
  passwordHash: string;
}) {
  return prisma.customer.create({ data });
}

// Reclama un registro heredado (teléfono ya existente, sin contraseña y sin pedidos). Todo en
// una transacción: se borra lo que colgaba del registro anterior (direcciones, dispositivos
// push, favoritos), porque lo creó quien tecleó ese teléfono SIN verificarlo y no debe pasar
// a quien lo reclama (ni seguir recibiendo sus notificaciones). El updateMany condicionado a
// passwordHash = null hace la reclamación atómica frente a dos registros simultáneos.
// Devuelve null si alguien lo reclamó antes.
export function claimLegacyCustomer(
  customerId: string,
  data: { name: string; email?: string; passwordHash: string },
) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.customer.updateMany({
      where: { id: customerId, passwordHash: null },
      data: { name: data.name, email: data.email ?? null, passwordHash: data.passwordHash },
    });
    if (claimed.count === 0) {
      return null;
    }
    await tx.customerAddress.deleteMany({ where: { customerId } });
    await tx.customerDevice.deleteMany({ where: { customerId } });
    await tx.customerFavoriteBusiness.deleteMany({ where: { customerId } });
    await tx.customerFavoriteProduct.deleteMany({ where: { customerId } });
    return tx.customer.findUnique({ where: { id: customerId } });
  });
}

export function createRefreshToken(data: {
  customerId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}) {
  return prisma.customerRefreshToken.create({ data });
}

export function findRefreshTokenByHash(tokenHash: string) {
  return prisma.customerRefreshToken.findUnique({
    where: { tokenHash },
    include: { customer: true },
  });
}

// Rotación: el token viejo NO se revoca; se le recorta la vigencia a `graceUntil` (si ya
// vencía antes, se deja como está) y se anota su sucesor. Así un reintento con mala conexión
// dentro de la ventana de gracia sigue funcionando.
export function shortenRefreshToken(id: string, graceUntil: Date, replacedByTokenHash: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.customerRefreshToken.findUnique({ where: { id } });
    if (!current) {
      return;
    }
    await tx.customerRefreshToken.update({
      where: { id },
      data: {
        replacedByTokenHash,
        expiresAt: current.expiresAt < graceUntil ? current.expiresAt : graceUntil,
      },
    });
  });
}

// Revoca solo si sigue activo. Devuelve cuántos se revocaron (0 = ya estaba revocado).
export function revokeRefreshTokenByHash(tokenHash: string) {
  return prisma.customerRefreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function revokeAllCustomerRefreshTokens(customerId: string) {
  return prisma.customerRefreshToken.updateMany({
    where: { customerId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function deleteExpiredRefreshTokens(customerId: string, now: Date) {
  return prisma.customerRefreshToken.deleteMany({
    where: { customerId, expiresAt: { lt: now } },
  });
}

export function createPasswordResetToken(data: {
  customerId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.$transaction(async (tx) => {
    // Un solo enlace de recuperación vivo por cliente: pedir otro invalida el anterior.
    await tx.customerPasswordResetToken.updateMany({
      where: { customerId: data.customerId, usedAt: null },
      data: { usedAt: new Date() },
    });
    return tx.customerPasswordResetToken.create({ data });
  });
}

export function findValidPasswordResetToken(tokenHash: string, now: Date) {
  return prisma.customerPasswordResetToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    include: { customer: true },
  });
}

// Consume el token (un solo uso, atómico), cambia la contraseña y cierra TODAS las sesiones.
// Devuelve false si otra request consumió el token antes.
export function consumeResetTokenAndSetPassword(
  resetTokenId: string,
  customerId: string,
  passwordHash: string,
) {
  return prisma.$transaction(async (tx) => {
    const consumed = await tx.customerPasswordResetToken.updateMany({
      where: { id: resetTokenId, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) {
      return false;
    }
    await tx.customer.update({ where: { id: customerId }, data: { passwordHash } });
    await tx.customerRefreshToken.updateMany({
      where: { customerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return true;
  });
}

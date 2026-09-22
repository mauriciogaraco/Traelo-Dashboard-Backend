import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export function createWithUser(
  userData: Prisma.UserUncheckedCreateInput,
  delivererData: { joinedAt?: Date; commissionPercentage?: number; photoUrl?: string },
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: userData });
    return tx.deliverer.create({
      data: {
        userId: user.id,
        ...(delivererData.joinedAt ? { joinedAt: delivererData.joinedAt } : {}),
        commissionPercentage: delivererData.commissionPercentage,
        photoUrl: delivererData.photoUrl,
      },
      include: { user: true },
    });
  });
}

export function findById(id: string) {
  return prisma.deliverer.findUnique({ where: { id }, include: { user: true } });
}

export function findByUserId(userId: string) {
  return prisma.deliverer.findUnique({ where: { userId }, include: { user: true } });
}

export function findMany(where: Prisma.DelivererWhereInput, skip: number, take: number) {
  return prisma.deliverer.findMany({
    where,
    skip,
    take,
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  });
}

export function count(where: Prisma.DelivererWhereInput) {
  return prisma.deliverer.count({ where });
}

export function updateWithUser(
  delivererId: string,
  userId: string,
  userData: Prisma.UserUpdateInput,
  delivererData: Prisma.DelivererUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: userData });
    await tx.deliverer.update({ where: { id: delivererId }, data: delivererData });
    return tx.deliverer.findUniqueOrThrow({ where: { id: delivererId }, include: { user: true } });
  });
}

// "Reiniciar historial" (app móvil) — ver el comentario en el modelo Deliverer (schema.prisma).
export function setHistoryResetAt(delivererId: string, historyResetAt: Date) {
  return prisma.deliverer.update({
    where: { id: delivererId },
    data: { historyResetAt },
    include: { user: true },
  });
}

// Notificaciones push (app móvil) — ver el comentario en Deliverer.expoPushToken (schema.prisma).
export function setExpoPushToken(delivererId: string, expoPushToken: string | null) {
  return prisma.deliverer.update({
    where: { id: delivererId },
    data: { expoPushToken },
    include: { user: true },
  });
}

// Cola de despacho automático — ver el comentario en el modelo Deliverer (schema.prisma).
export function setQueuedAt(delivererId: string, queuedAt: Date | null) {
  return prisma.deliverer.update({
    where: { id: delivererId },
    data: { queuedAt },
    include: { user: true },
  });
}

// El siguiente en turno: el que está en línea (queuedAt no-null) desde hace más tiempo, entre
// los que además siguen habilitados (user.active) — un mensajero dado de baja no debe recibir
// pedidos nuevos aunque nunca se haya puesto fuera de línea él mismo.
//
// excludeDelivererId se usa al re-despachar tras un decline (ver ordersService.declineOrder):
// sin esto, si quien acaba de declinar no llegó a la cola vía el despacho automático (p.ej. el
// staff lo asignó a mano), seguiría siendo "el más antiguo" y se le volvería a ofrecer el mismo
// pedido que acaba de rechazar. Con la exclusión, la cola avanza sí o sí al siguiente — y en
// pedidos futuros (una vez ya excluido de este lookup) puede volver a tocarle su turno normal.
export function findNextInQueue(excludeDelivererId?: string) {
  return prisma.deliverer.findFirst({
    where: {
      queuedAt: { not: null },
      user: { active: true },
      ...(excludeDelivererId ? { id: { not: excludeDelivererId } } : {}),
    },
    orderBy: { queuedAt: 'asc' },
    include: { user: true },
  });
}

// Se llama justo después de asignarle un pedido al de turno — lo manda al final de la cola
// (mismo mecanismo que activarse: un timestamp fresco siempre queda detrás de todos).
export function bumpQueue(delivererId: string) {
  return prisma.deliverer.update({ where: { id: delivererId }, data: { queuedAt: new Date() } });
}

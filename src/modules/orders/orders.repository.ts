import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export const orderInclude = {
  deliverer: { include: { user: { select: { id: true, name: true, phone: true } } } },
  registeredBy: { select: { id: true, name: true } },
  businesses: {
    include: {
      business: { select: { id: true, name: true } },
      items: true,
    },
  },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function create(data: Prisma.OrderCreateInput) {
  return prisma.order.create({ data, include: orderInclude });
}

export function findById(id: string) {
  return prisma.order.findUnique({ where: { id }, include: orderInclude });
}

export function findByClientRequestId(clientRequestId: string) {
  return prisma.order.findUnique({ where: { clientRequestId }, include: orderInclude });
}

// Antispam (Fase 14): el pedido PENDING más reciente de este teléfono, creado desde la app,
// dentro de la ventana de cooldown — null si no hay ninguno (puede reordenar).
export function findRecentPendingAppOrderByPhone(customerPhone: string, since: Date) {
  return prisma.order.findFirst({
    where: { customerPhone, source: 'APP', status: 'PENDING', orderDate: { gte: since } },
    orderBy: { orderDate: 'desc' },
  });
}

export function findMany(where: Prisma.OrderWhereInput, skip: number, take: number) {
  return prisma.order.findMany({
    where,
    skip,
    take,
    orderBy: { orderDate: 'desc' },
    include: orderInclude,
  });
}

export function count(where: Prisma.OrderWhereInput) {
  return prisma.order.count({ where });
}

export function update(id: string, data: Prisma.OrderUpdateInput) {
  return prisma.order.update({ where: { id }, data, include: orderInclude });
}

export function remove(id: string) {
  return prisma.order.delete({ where: { id } });
}

export function countSettlementLines(orderId: string) {
  return prisma.settlementOrderLine.count({ where: { orderId } });
}

export function countClosedSettlementLines(orderId: string) {
  return prisma.settlementOrderLine.count({
    where: { orderId, settlement: { status: 'CLOSED' } },
  });
}

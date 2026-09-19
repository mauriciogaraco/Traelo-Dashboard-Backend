import { prisma } from '../../shared/prisma';
import type { DateRange } from '../../shared/date-range';
import type { Prisma } from '../../generated/prisma/client';

// Todo lo de este archivo está acotado a UN negocio (`businessId`), que siempre viene de
// resolveOwnerBusinessId() en el servidor — nunca de un parámetro del cliente.

export function countOrdersByStatus(businessId: string, range: DateRange) {
  return prisma.order.groupBy({
    by: ['status'],
    where: {
      orderDate: { gte: range.from, lte: range.to },
      businesses: { some: { businessId } },
    },
    _count: { _all: true },
  });
}

// Pedidos "en curso" ahora mismo, sin importar el rango elegido.
export function countActiveOrders(businessId: string) {
  return prisma.order.count({
    where: {
      status: { in: ['PENDING', 'ASSIGNED'] },
      businesses: { some: { businessId } },
    },
  });
}

// SOLO campos que el dueño puede ver: nada de teléfono/dirección del cliente, ni mensajería,
// ni Servicio Tráelo, ni comisiones, ni ganancias de mensajero.
const portalOrderSelect = (businessId: string) =>
  ({
    id: true,
    orderNumber: true,
    orderDate: true,
    completedAt: true,
    status: true,
    customerName: true,
    deliverer: { select: { user: { select: { name: true } } } },
    businesses: {
      where: { businessId },
      select: {
        subtotal: true,
        items: {
          select: { id: true, productName: true, quantity: true, unitPrice: true, subtotal: true },
        },
      },
    },
  }) satisfies Prisma.OrderSelect;

export function findOrders(
  businessId: string,
  where: Prisma.OrderWhereInput,
  skip: number,
  take: number,
) {
  return prisma.order.findMany({
    where: { ...where, businesses: { some: { businessId } } },
    skip,
    take,
    orderBy: { orderDate: 'desc' },
    select: portalOrderSelect(businessId),
  });
}

export function countOrders(businessId: string, where: Prisma.OrderWhereInput) {
  return prisma.order.count({ where: { ...where, businesses: { some: { businessId } } } });
}

export function findCompletedOrdersForCustomers(businessId: string, range: DateRange) {
  return prisma.order.findMany({
    where: {
      status: 'COMPLETED',
      completedAt: { gte: range.from, lte: range.to },
      businesses: { some: { businessId } },
    },
    select: {
      customerPhone: true,
      customerName: true,
      orderDate: true,
      businesses: { where: { businessId }, select: { subtotal: true } },
    },
    orderBy: { orderDate: 'desc' },
  });
}

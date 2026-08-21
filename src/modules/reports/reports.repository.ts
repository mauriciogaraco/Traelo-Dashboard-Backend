import { prisma } from '../../shared/prisma';
import type { DateRange } from '../../shared/date-range';

export function countOrders(range: DateRange) {
  return prisma.order.count({ where: { orderDate: { gte: range.from, lte: range.to } } });
}

export function countCompletedOrders(range: DateRange) {
  return prisma.order.count({
    where: { status: 'COMPLETED', completedAt: { gte: range.from, lte: range.to } },
  });
}

export function aggregateCompletedOrders(range: DateRange) {
  return prisma.order.aggregate({
    where: { status: 'COMPLETED', completedAt: { gte: range.from, lte: range.to } },
    _sum: {
      total: true,
      productsTotal: true,
      deliveryFee: true,
      delivererEarning: true,
      platformFee: true,
      traeloDeliveryShare: true,
    },
  });
}

export function topBusinessesByRevenue(range: DateRange, limit: number) {
  return prisma.orderBusiness.groupBy({
    by: ['businessId'],
    where: { order: { status: 'COMPLETED', completedAt: { gte: range.from, lte: range.to } } },
    _sum: { subtotal: true, commissionEarned: true },
    _count: { _all: true },
    orderBy: { _sum: { subtotal: 'desc' } },
    take: limit,
  });
}

export function findBusinessNames(businessIds: string[]) {
  return prisma.business.findMany({
    where: { id: { in: businessIds } },
    select: { id: true, name: true },
  });
}

export function topDeliverersByDeliveries(range: DateRange, limit: number) {
  return prisma.order.groupBy({
    by: ['delivererId'],
    where: {
      status: 'COMPLETED',
      completedAt: { gte: range.from, lte: range.to },
      delivererId: { not: null },
    },
    _count: { id: true },
    _sum: { delivererEarning: true, platformFee: true },
    orderBy: { _count: { id: 'desc' } },
    take: limit,
  });
}

export function findDelivererNames(delivererIds: string[]) {
  return prisma.deliverer.findMany({
    where: { id: { in: delivererIds } },
    select: { id: true, user: { select: { name: true } } },
  });
}

export function listBusinessesByRevenue(
  range: DateRange,
  opts: { skip: number; take: number; search?: string },
) {
  return prisma.orderBusiness.groupBy({
    by: ['businessId'],
    where: {
      order: { status: 'COMPLETED', completedAt: { gte: range.from, lte: range.to } },
      ...(opts.search ? { business: { name: { contains: opts.search, mode: 'insensitive' } } } : {}),
    },
    _sum: { subtotal: true, commissionEarned: true },
    _count: { _all: true },
    orderBy: { _sum: { subtotal: 'desc' } },
    skip: opts.skip,
    take: opts.take,
  });
}

// Prisma no soporta "count de grupos" directamente en groupBy: se pide el mismo agrupamiento
// sin skip/take y se usa la cantidad de filas devueltas — aceptable dado que la cantidad de
// negocios/mensajeros de este negocio es chica (decenas, no miles).
export async function countBusinessesWithSales(range: DateRange, search?: string): Promise<number> {
  const groups = await prisma.orderBusiness.groupBy({
    by: ['businessId'],
    where: {
      order: { status: 'COMPLETED', completedAt: { gte: range.from, lte: range.to } },
      ...(search ? { business: { name: { contains: search, mode: 'insensitive' } } } : {}),
    },
  });
  return groups.length;
}

export function getBusinessSalesAggregate(businessId: string, range: DateRange) {
  return prisma.orderBusiness.aggregate({
    where: {
      businessId,
      order: { status: 'COMPLETED', completedAt: { gte: range.from, lte: range.to } },
    },
    _sum: { subtotal: true, commissionEarned: true },
    _max: { subtotal: true },
    _count: { _all: true },
  });
}

export function getTopProductsForBusiness(businessId: string, range: DateRange, limit: number) {
  return prisma.orderItem.groupBy({
    by: ['productId', 'productName'],
    where: {
      orderBusiness: {
        businessId,
        order: { status: 'COMPLETED', completedAt: { gte: range.from, lte: range.to } },
      },
    },
    _sum: { quantity: true, subtotal: true },
    orderBy: { _sum: { subtotal: 'desc' } },
    take: limit,
  });
}

export function listDeliverersByDeliveries(
  range: DateRange,
  opts: { skip: number; take: number; search?: string },
) {
  return prisma.order.groupBy({
    by: ['delivererId'],
    where: {
      status: 'COMPLETED',
      completedAt: { gte: range.from, lte: range.to },
      delivererId: { not: null },
      ...(opts.search
        ? { deliverer: { user: { name: { contains: opts.search, mode: 'insensitive' } } } }
        : {}),
    },
    _count: { id: true },
    _sum: { delivererEarning: true, platformFee: true },
    orderBy: { _count: { id: 'desc' } },
    skip: opts.skip,
    take: opts.take,
  });
}

export async function countDeliverersWithDeliveries(range: DateRange, search?: string): Promise<number> {
  const groups = await prisma.order.groupBy({
    by: ['delivererId'],
    where: {
      status: 'COMPLETED',
      completedAt: { gte: range.from, lte: range.to },
      delivererId: { not: null },
      ...(search ? { deliverer: { user: { name: { contains: search, mode: 'insensitive' } } } } : {}),
    },
  });
  return groups.length;
}

export function getDelivererSalesAggregate(delivererId: string, range: DateRange) {
  return prisma.order.aggregate({
    where: { delivererId, status: 'COMPLETED', completedAt: { gte: range.from, lte: range.to } },
    _count: { _all: true },
    _sum: { delivererEarning: true, platformFee: true },
  });
}

// Sin agregación de Prisma: `delivererId` vive en Order, no en OrderItem, así que no se puede
// agrupar por mensajero + producto en una sola query de groupBy. Se trae cada pedido completado
// de este negocio en el rango (con sus items) y se suma por (mensajero, producto) en JS — el
// volumen esperado (pedidos de un solo negocio en un periodo) es chico.
export function getBusinessOrdersForDelivererBreakdown(businessId: string, range: DateRange) {
  return prisma.order.findMany({
    where: {
      status: 'COMPLETED',
      completedAt: { gte: range.from, lte: range.to },
      delivererId: { not: null },
      businesses: { some: { businessId } },
    },
    select: {
      delivererId: true,
      deliverer: { select: { user: { select: { name: true } } } },
      businesses: {
        where: { businessId },
        select: {
          items: {
            select: { productId: true, productName: true, quantity: true, subtotal: true },
          },
        },
      },
    },
  });
}

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
    _sum: { delivererEarning: true },
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

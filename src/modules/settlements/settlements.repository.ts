import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';
import type { SettlementType } from '../../generated/prisma/enums';

export const settlementInclude = {
  deliverer: { include: { user: { select: { id: true, name: true } } } },
  closedBy: { select: { id: true, name: true } },
} satisfies Prisma.SettlementInclude;

export type SettlementWithRelations = Prisma.SettlementGetPayload<{
  include: typeof settlementInclude;
}>;

interface SettlementKey {
  delivererId: string;
  type: SettlementType;
  periodStart: Date;
  periodEnd: Date;
}

interface SettlementTotalsInput {
  totalDeliveries: number;
  totalCollected: Prisma.Decimal;
  traeloDeliveryShare: Prisma.Decimal;
  delivererShare: Prisma.Decimal;
  platformFeeCollected: Prisma.Decimal;
  totalToDeliver: Prisma.Decimal;
}

export function findByKey(key: SettlementKey) {
  return prisma.settlement.findUnique({
    where: { delivererId_type_periodStart_periodEnd: key },
    include: settlementInclude,
  });
}

export function findById(id: string) {
  return prisma.settlement.findUnique({ where: { id }, include: settlementInclude });
}

export function findMany(where: Prisma.SettlementWhereInput, skip: number, take: number) {
  return prisma.settlement.findMany({
    where,
    skip,
    take,
    orderBy: { periodStart: 'desc' },
    include: settlementInclude,
  });
}

export function count(where: Prisma.SettlementWhereInput) {
  return prisma.settlement.count({ where });
}

export function update(id: string, data: Prisma.SettlementUpdateInput) {
  return prisma.settlement.update({ where: { id }, data, include: settlementInclude });
}

export function findOrdersBySettlementId(settlementId: string) {
  return prisma.order.findMany({
    where: { settlementLines: { some: { settlementId } } },
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      completedAt: true,
      deliveryFee: true,
      delivererEarning: true,
      traeloDeliveryShare: true,
      platformFee: true,
      total: true,
      businesses: {
        select: {
          businessNameSnapshot: true,
          business: { select: { name: true } },
        },
      },
    },
    orderBy: { completedAt: 'asc' },
  });
}

export function findEligibleOrders(delivererId: string, periodStart: Date, periodEnd: Date) {
  return prisma.order.findMany({
    where: {
      delivererId,
      status: 'COMPLETED',
      completedAt: { gte: periodStart, lte: periodEnd },
      settlementLines: { none: { settlement: { status: 'CLOSED' } } },
    },
    select: {
      id: true,
      deliveryFee: true,
      delivererEarning: true,
      traeloDeliveryShare: true,
      platformFee: true,
    },
  });
}

export function generateSettlementRecord(
  key: SettlementKey,
  totals: SettlementTotalsInput,
  orderIds: string[],
) {
  return prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.upsert({
      where: { delivererId_type_periodStart_periodEnd: key },
      update: totals,
      create: { ...key, ...totals },
    });

    await tx.settlementOrderLine.deleteMany({ where: { settlementId: settlement.id } });
    if (orderIds.length > 0) {
      await tx.settlementOrderLine.createMany({
        data: orderIds.map((orderId) => ({ settlementId: settlement.id, orderId })),
      });
    }

    return tx.settlement.findUniqueOrThrow({
      where: { id: settlement.id },
      include: settlementInclude,
    });
  });
}

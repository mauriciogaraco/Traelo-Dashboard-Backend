import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export function findByIdForBusiness(id: string, businessId: string) {
  return prisma.businessSubscription.findFirst({ where: { id, businessId } });
}

export function findMany(businessId: string, skip: number, take: number) {
  return prisma.businessSubscription.findMany({
    where: { businessId },
    skip,
    take,
    orderBy: { startDate: 'desc' },
  });
}

export function count(businessId: string) {
  return prisma.businessSubscription.count({ where: { businessId } });
}

export function findCurrentActive(businessId: string) {
  return prisma.businessSubscription.findFirst({
    where: { businessId, status: 'ACTIVE' },
    orderBy: { startDate: 'desc' },
  });
}

export function update(id: string, data: Prisma.BusinessSubscriptionUpdateInput) {
  return prisma.businessSubscription.update({ where: { id }, data });
}

export function createReplacingActive(
  businessId: string,
  data: Prisma.BusinessSubscriptionUncheckedCreateInput,
) {
  return prisma.$transaction(async (tx) => {
    await tx.businessSubscription.updateMany({
      where: { businessId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
    return tx.businessSubscription.create({ data });
  });
}

import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export function create(data: Prisma.ProductOfferUncheckedCreateInput) {
  return prisma.productOffer.create({ data });
}

export function findByIdForProduct(id: string, productId: string) {
  return prisma.productOffer.findFirst({ where: { id, productId } });
}

export function findActiveForProduct(productId: string, now: Date) {
  return prisma.productOffer.findFirst({
    where: { productId, active: true, startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { startsAt: 'desc' },
  });
}

export function findManyForProduct(productId: string) {
  return prisma.productOffer.findMany({ where: { productId }, orderBy: { startsAt: 'desc' } });
}

export function update(id: string, data: Prisma.ProductOfferUpdateInput) {
  return prisma.productOffer.update({ where: { id }, data });
}

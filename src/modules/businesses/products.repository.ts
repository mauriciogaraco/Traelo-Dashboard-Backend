import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export function create(data: Prisma.ProductUncheckedCreateInput) {
  return prisma.product.create({ data, include: { commission: true } });
}

export function findByIdForBusiness(id: string, businessId: string) {
  return prisma.product.findFirst({ where: { id, businessId }, include: { commission: true } });
}

export function findMany(where: Prisma.ProductWhereInput, skip: number, take: number) {
  return prisma.product.findMany({
    where,
    skip,
    take,
    orderBy: { createdAt: 'desc' },
    include: { commission: true },
  });
}

export function count(where: Prisma.ProductWhereInput) {
  return prisma.product.count({ where });
}

export function update(id: string, data: Prisma.ProductUpdateInput) {
  return prisma.product.update({ where: { id }, data, include: { commission: true } });
}

export function upsertCommission(businessId: string, productId: string, commissionAmount: number) {
  return prisma.businessProductCommission.upsert({
    where: { productId },
    update: { commissionAmount },
    create: { businessId, productId, commissionAmount },
  });
}

export function deleteCommission(productId: string) {
  return prisma.businessProductCommission.deleteMany({ where: { productId } });
}

import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export function create(data: Prisma.ProductUncheckedCreateInput) {
  return prisma.product.create({ data, include: { commission: true } });
}

export function findByIdForBusiness(id: string, businessId: string) {
  return prisma.product.findFirst({ where: { id, businessId }, include: { commission: true } });
}

export function findById(id: string) {
  return prisma.product.findUnique({ where: { id } });
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

// Unchecked: updateProduct/setProductAvailability pasan categoryId (FK cruda) directamente
// en vez de la forma anidada { categoryRef: { connect/disconnect } } del input "checked".
export function update(id: string, data: Prisma.ProductUncheckedUpdateInput) {
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

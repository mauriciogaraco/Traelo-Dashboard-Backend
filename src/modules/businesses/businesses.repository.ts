import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export function create(data: Prisma.BusinessCreateInput) {
  return prisma.business.create({ data });
}

export function findById(id: string) {
  return prisma.business.findUnique({ where: { id } });
}

export function findMany(where: Prisma.BusinessWhereInput, skip: number, take: number) {
  return prisma.business.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } });
}

export function count(where: Prisma.BusinessWhereInput) {
  return prisma.business.count({ where });
}

export function update(id: string, data: Prisma.BusinessUpdateInput) {
  return prisma.business.update({ where: { id }, data });
}

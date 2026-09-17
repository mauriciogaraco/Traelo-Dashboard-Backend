import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export function create(data: Prisma.CategoryCreateInput) {
  return prisma.category.create({ data });
}

export function findById(id: string) {
  return prisma.category.findUnique({ where: { id } });
}

export function findBySlug(slug: string) {
  return prisma.category.findUnique({ where: { slug } });
}

export function findMany(where: Prisma.CategoryWhereInput, skip: number, take: number) {
  return prisma.category.findMany({
    where,
    skip,
    take,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export function count(where: Prisma.CategoryWhereInput) {
  return prisma.category.count({ where });
}

export function update(id: string, data: Prisma.CategoryUpdateInput) {
  return prisma.category.update({ where: { id }, data });
}

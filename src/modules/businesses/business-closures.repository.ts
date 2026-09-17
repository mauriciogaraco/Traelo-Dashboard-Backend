import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export function findManyForBusiness(businessId: string, upcoming: boolean) {
  return prisma.businessClosure.findMany({
    where: { businessId, ...(upcoming ? { date: { gte: new Date() } } : {}) },
    orderBy: { date: 'asc' },
  });
}

export function findByIdForBusiness(id: string, businessId: string) {
  return prisma.businessClosure.findFirst({ where: { id, businessId } });
}

export function findByBusinessAndDate(businessId: string, date: Date) {
  return prisma.businessClosure.findUnique({ where: { businessId_date: { businessId, date } } });
}

export function create(data: Prisma.BusinessClosureUncheckedCreateInput) {
  return prisma.businessClosure.create({ data });
}

export function deleteById(id: string) {
  return prisma.businessClosure.delete({ where: { id } });
}

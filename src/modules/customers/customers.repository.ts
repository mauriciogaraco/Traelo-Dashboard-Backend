import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export function create(data: Prisma.CustomerCreateInput) {
  return prisma.customer.create({ data });
}

export function findById(id: string) {
  return prisma.customer.findUnique({ where: { id } });
}

export function findByPhone(phone: string) {
  return prisma.customer.findUnique({ where: { phone } });
}

export function update(id: string, data: Prisma.CustomerUpdateInput) {
  return prisma.customer.update({ where: { id }, data });
}

export function touchLastOrderAt(id: string, date: Date) {
  return prisma.customer.update({ where: { id }, data: { lastOrderAt: date } });
}

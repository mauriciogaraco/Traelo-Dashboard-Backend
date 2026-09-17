import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export function findByIdForCustomer(id: string, customerId: string) {
  return prisma.customerDevice.findFirst({ where: { id, customerId } });
}

export function create(data: Prisma.CustomerDeviceUncheckedCreateInput) {
  return prisma.customerDevice.create({ data });
}

export function update(id: string, data: Prisma.CustomerDeviceUpdateInput) {
  return prisma.customerDevice.update({ where: { id }, data });
}

export function deleteById(id: string) {
  return prisma.customerDevice.delete({ where: { id } });
}

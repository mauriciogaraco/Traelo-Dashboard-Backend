import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export function createWithUser(
  userData: Prisma.UserUncheckedCreateInput,
  delivererData: { joinedAt?: Date; commissionPercentage?: number },
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: userData });
    return tx.deliverer.create({
      data: {
        userId: user.id,
        ...(delivererData.joinedAt ? { joinedAt: delivererData.joinedAt } : {}),
        commissionPercentage: delivererData.commissionPercentage,
      },
      include: { user: true },
    });
  });
}

export function findById(id: string) {
  return prisma.deliverer.findUnique({ where: { id }, include: { user: true } });
}

export function findByUserId(userId: string) {
  return prisma.deliverer.findUnique({ where: { userId }, include: { user: true } });
}

export function findMany(where: Prisma.DelivererWhereInput, skip: number, take: number) {
  return prisma.deliverer.findMany({
    where,
    skip,
    take,
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  });
}

export function count(where: Prisma.DelivererWhereInput) {
  return prisma.deliverer.count({ where });
}

export function updateWithUser(
  delivererId: string,
  userId: string,
  userData: Prisma.UserUpdateInput,
  delivererData: Prisma.DelivererUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: userData });
    await tx.deliverer.update({ where: { id: delivererId }, data: delivererData });
    return tx.deliverer.findUniqueOrThrow({ where: { id: delivererId }, include: { user: true } });
  });
}

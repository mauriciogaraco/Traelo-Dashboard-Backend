import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';
import type { CreateUserInput } from './users.dto';

// Trae el nombre del negocio para poder mostrar "dueño de X" sin una segunda consulta.
const userInclude = { business: { select: { id: true, name: true } } } as const;

export function findByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export function findById(id: string) {
  return prisma.user.findUnique({ where: { id }, include: userInclude });
}

export function create(input: CreateUserInput & { passwordHash: string }) {
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      phone: input.phone,
      role: input.role,
      ...(input.businessId ? { businessId: input.businessId } : {}),
    },
    include: userInclude,
  });
}

export function update(id: string, data: Prisma.UserUpdateInput) {
  return prisma.user.update({ where: { id }, data, include: userInclude });
}

export function findMany(where: Prisma.UserWhereInput, skip: number, take: number) {
  return prisma.user.findMany({
    where,
    skip,
    take,
    orderBy: { createdAt: 'desc' },
    include: userInclude,
  });
}

export function count(where: Prisma.UserWhereInput) {
  return prisma.user.count({ where });
}

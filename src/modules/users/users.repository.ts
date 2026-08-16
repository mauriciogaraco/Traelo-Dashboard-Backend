import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';
import type { CreateUserInput } from './users.dto';

export function findByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export function findById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export function create(input: CreateUserInput & { passwordHash: string }) {
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      phone: input.phone,
      role: input.role,
    },
  });
}

export function update(id: string, data: Prisma.UserUpdateInput) {
  return prisma.user.update({ where: { id }, data });
}

export function findMany(where: Prisma.UserWhereInput, skip: number, take: number) {
  return prisma.user.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } });
}

export function count(where: Prisma.UserWhereInput) {
  return prisma.user.count({ where });
}

import bcrypt from 'bcrypt';
import { NotFoundError, ConflictError, BadRequestError } from '../../shared/errors';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import type { Prisma } from '../../generated/prisma/client';
import { Role } from '../../generated/prisma/enums';
import * as businessesRepository from '../businesses/businesses.repository';
import * as usersRepository from './users.repository';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './users.dto';

const PASSWORD_SALT_ROUNDS = 12;

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
  // Solo para BUSINESS_OWNER; null en el resto de los roles.
  businessId: string | null;
  businessName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(user: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
  businessId: string | null;
  business?: { name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}): UserDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    active: user.active,
    businessId: user.businessId,
    businessName: user.business?.name ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function createUser(input: CreateUserInput): Promise<UserDTO> {
  const existing = await usersRepository.findByEmail(input.email);
  if (existing) {
    throw new ConflictError('Ya existe un usuario con ese correo');
  }

  if (input.businessId) {
    await assertBusinessAvailableForOwner(input.businessId);
  }

  const passwordHash = await bcrypt.hash(input.password, PASSWORD_SALT_ROUNDS);
  const user = await usersRepository.create({ ...input, passwordHash });
  return toDTO(user);
}

async function assertBusinessAvailableForOwner(businessId: string): Promise<void> {
  const business = await businessesRepository.findById(businessId);
  if (!business) {
    throw new NotFoundError('Negocio no encontrado');
  }
  if (!business.active) {
    throw new BadRequestError('No se puede asociar un dueño a un negocio inactivo');
  }
}

export async function listUsers(
  query: ListUsersQuery,
): Promise<{ data: UserDTO[]; meta: PaginationMeta }> {
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.active !== undefined ? { active: query.active } : {}),
  };

  const { skip, take } = toSkipTake(query);
  const [users, total] = await Promise.all([
    usersRepository.findMany(where, skip, take),
    usersRepository.count(where),
  ]);

  return { data: users.map(toDTO), meta: buildPaginationMeta(query, total) };
}

export async function getUserById(id: string): Promise<UserDTO> {
  const user = await usersRepository.findById(id);
  if (!user) {
    throw new NotFoundError('Usuario no encontrado');
  }
  return toDTO(user);
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<UserDTO> {
  const existing = await getUserById(id);
  const { businessId, ...rest } = input;

  if (businessId !== undefined) {
    if (existing.role !== Role.BUSINESS_OWNER) {
      throw new BadRequestError('Solo los dueños de negocio llevan un negocio asociado');
    }
    await assertBusinessAvailableForOwner(businessId);
  }

  const user = await usersRepository.update(id, {
    ...rest,
    ...(businessId !== undefined ? { business: { connect: { id: businessId } } } : {}),
  });
  return toDTO(user);
}

export async function deactivateUser(id: string): Promise<UserDTO> {
  await getUserById(id);
  const user = await usersRepository.update(id, { active: false });
  return toDTO(user);
}

export async function resetPassword(id: string, password: string): Promise<UserDTO> {
  await getUserById(id);
  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
  const user = await usersRepository.update(id, { passwordHash });
  return toDTO(user);
}

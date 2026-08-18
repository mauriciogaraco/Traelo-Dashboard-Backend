import bcrypt from 'bcrypt';
import { NotFoundError, ConflictError } from '../../shared/errors';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import type { Prisma } from '../../generated/prisma/client';
import type { Role } from '../../generated/prisma/enums';
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
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function createUser(input: CreateUserInput): Promise<UserDTO> {
  const existing = await usersRepository.findByEmail(input.email);
  if (existing) {
    throw new ConflictError('Ya existe un usuario con ese correo');
  }

  const passwordHash = await bcrypt.hash(input.password, PASSWORD_SALT_ROUNDS);
  const user = await usersRepository.create({ ...input, passwordHash });
  return toDTO(user);
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
  await getUserById(id);
  const user = await usersRepository.update(id, input);
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

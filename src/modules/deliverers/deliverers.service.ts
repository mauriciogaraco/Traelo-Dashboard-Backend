import bcrypt from 'bcrypt';
import { NotFoundError, ConflictError } from '../../shared/errors';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import { decimalToNumber } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';
import * as usersRepository from '../users/users.repository';
import * as systemConfigService from '../../config/system-config.service';
import * as deliverersRepository from './deliverers.repository';
import type {
  CreateDelivererInput,
  ListDeliverersQuery,
  UpdateDelivererInput,
} from './deliverers.dto';

const PASSWORD_SALT_ROUNDS = 12;

export interface DelivererDTO {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  active: boolean;
  joinedAt: Date;
  commissionPercentage: number | null;
  effectiveCommissionPercentage: number;
  createdAt: Date;
  updatedAt: Date;
}

interface DelivererRecord {
  id: string;
  userId: string;
  joinedAt: Date;
  commissionPercentage: Prisma.Decimal | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    name: string;
    email: string;
    phone: string | null;
    active: boolean;
  };
}

function toDTO(record: DelivererRecord, defaultCommissionPercentage: number): DelivererDTO {
  const commissionPercentage = decimalToNumber(record.commissionPercentage);
  return {
    id: record.id,
    userId: record.userId,
    name: record.user.name,
    email: record.user.email,
    phone: record.user.phone,
    active: record.user.active,
    joinedAt: record.joinedAt,
    commissionPercentage,
    effectiveCommissionPercentage: commissionPercentage ?? defaultCommissionPercentage,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function createDeliverer(input: CreateDelivererInput): Promise<DelivererDTO> {
  const existing = await usersRepository.findByEmail(input.email);
  if (existing) {
    throw new ConflictError('Ya existe un usuario con ese correo');
  }

  const passwordHash = await bcrypt.hash(input.password, PASSWORD_SALT_ROUNDS);
  const deliverer = await deliverersRepository.createWithUser(
    {
      name: input.name,
      email: input.email,
      passwordHash,
      phone: input.phone,
      role: 'DELIVERER',
    },
    { joinedAt: input.joinedAt, commissionPercentage: input.commissionPercentage },
  );

  const config = await systemConfigService.getSystemConfig();
  return toDTO(deliverer, config.defaultDelivererCommissionPercentage);
}

export async function listDeliverers(
  query: ListDeliverersQuery,
): Promise<{ data: DelivererDTO[]; meta: PaginationMeta }> {
  const where: Prisma.DelivererWhereInput = {
    ...(query.active !== undefined ? { user: { active: query.active } } : {}),
    ...(query.search ? { user: { name: { contains: query.search, mode: 'insensitive' } } } : {}),
  };

  const { skip, take } = toSkipTake(query);
  const [records, total, config] = await Promise.all([
    deliverersRepository.findMany(where, skip, take),
    deliverersRepository.count(where),
    systemConfigService.getSystemConfig(),
  ]);

  return {
    data: records.map((record) => toDTO(record, config.defaultDelivererCommissionPercentage)),
    meta: buildPaginationMeta(query, total),
  };
}

export async function getDelivererById(id: string): Promise<DelivererDTO> {
  const record = await deliverersRepository.findById(id);
  if (!record) {
    throw new NotFoundError('Mensajero no encontrado');
  }
  const config = await systemConfigService.getSystemConfig();
  return toDTO(record, config.defaultDelivererCommissionPercentage);
}

export async function getDelivererByUserId(userId: string): Promise<DelivererDTO> {
  const record = await deliverersRepository.findByUserId(userId);
  if (!record) {
    throw new NotFoundError('Perfil de mensajero no encontrado');
  }
  const config = await systemConfigService.getSystemConfig();
  return toDTO(record, config.defaultDelivererCommissionPercentage);
}

export async function updateDeliverer(
  id: string,
  input: UpdateDelivererInput,
): Promise<DelivererDTO> {
  const existing = await deliverersRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Mensajero no encontrado');
  }

  const updated = await deliverersRepository.updateWithUser(
    id,
    existing.userId,
    { name: input.name, phone: input.phone, active: input.active },
    { commissionPercentage: input.commissionPercentage },
  );

  const config = await systemConfigService.getSystemConfig();
  return toDTO(updated, config.defaultDelivererCommissionPercentage);
}

export async function deactivateDeliverer(id: string): Promise<DelivererDTO> {
  const existing = await deliverersRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Mensajero no encontrado');
  }

  const updated = await deliverersRepository.updateWithUser(
    id,
    existing.userId,
    { active: false },
    {},
  );
  const config = await systemConfigService.getSystemConfig();
  return toDTO(updated, config.defaultDelivererCommissionPercentage);
}

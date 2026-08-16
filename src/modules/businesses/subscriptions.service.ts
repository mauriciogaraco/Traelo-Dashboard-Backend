import { NotFoundError, BadRequestError, ConflictError } from '../../shared/errors';
import {
  buildPaginationMeta,
  toSkipTake,
  type PaginationMeta,
  type PaginationQuery,
} from '../../shared/http';
import { decimalToNumber } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';
import type { SubscriptionCycle, SubscriptionStatus } from '../../generated/prisma/enums';
import * as businessesRepository from './businesses.repository';
import * as subscriptionsRepository from './subscriptions.repository';
import type { CreateSubscriptionInput, UpdateSubscriptionInput } from './subscriptions.dto';

const CYCLE_DAYS: Record<SubscriptionCycle, number> = {
  DAYS_7: 7,
  DAYS_15: 15,
  DAYS_21: 21,
  DAYS_30: 30,
};

export interface SubscriptionDTO {
  id: string;
  businessId: string;
  cycle: SubscriptionCycle;
  price: number;
  startDate: Date;
  endDate: Date;
  status: SubscriptionStatus;
  createdAt: Date;
}

interface SubscriptionRecord {
  id: string;
  businessId: string;
  cycle: SubscriptionCycle;
  price: Prisma.Decimal;
  startDate: Date;
  endDate: Date;
  status: SubscriptionStatus;
  createdAt: Date;
}

function toDTO(sub: SubscriptionRecord): SubscriptionDTO {
  return {
    id: sub.id,
    businessId: sub.businessId,
    cycle: sub.cycle,
    price: decimalToNumber(sub.price),
    startDate: sub.startDate,
    endDate: sub.endDate,
    status: sub.status,
    createdAt: sub.createdAt,
  };
}

async function assertBusinessExists(businessId: string): Promise<void> {
  const business = await businessesRepository.findById(businessId);
  if (!business) {
    throw new NotFoundError('Negocio no encontrado');
  }
}

async function withLazyExpiration(sub: SubscriptionRecord): Promise<SubscriptionRecord> {
  if (sub.status === 'ACTIVE' && sub.endDate.getTime() < Date.now()) {
    return subscriptionsRepository.update(sub.id, { status: 'EXPIRED' });
  }
  return sub;
}

export async function createSubscription(
  businessId: string,
  input: CreateSubscriptionInput,
): Promise<SubscriptionDTO> {
  await assertBusinessExists(businessId);

  const startDate = input.startDate ?? new Date();
  const endDate = input.endDate ?? addDays(startDate, CYCLE_DAYS[input.cycle]);

  if (endDate <= startDate) {
    throw new BadRequestError('endDate debe ser posterior a startDate');
  }

  const subscription = await subscriptionsRepository.createReplacingActive(businessId, {
    businessId,
    cycle: input.cycle,
    price: input.price,
    startDate,
    endDate,
    status: 'ACTIVE',
  });

  return toDTO(subscription);
}

export async function listSubscriptions(
  businessId: string,
  query: PaginationQuery,
): Promise<{ data: SubscriptionDTO[]; meta: PaginationMeta }> {
  await assertBusinessExists(businessId);

  const { skip, take } = toSkipTake(query);
  const [subscriptions, total] = await Promise.all([
    subscriptionsRepository.findMany(businessId, skip, take),
    subscriptionsRepository.count(businessId),
  ]);

  return { data: subscriptions.map(toDTO), meta: buildPaginationMeta(query, total) };
}

export async function getSubscription(businessId: string, subId: string): Promise<SubscriptionDTO> {
  const subscription = await subscriptionsRepository.findByIdForBusiness(subId, businessId);
  if (!subscription) {
    throw new NotFoundError('Suscripción no encontrada');
  }
  return toDTO(await withLazyExpiration(subscription));
}

export async function updateSubscription(
  businessId: string,
  subId: string,
  input: UpdateSubscriptionInput,
): Promise<SubscriptionDTO> {
  const existing = await subscriptionsRepository.findByIdForBusiness(subId, businessId);
  if (!existing) {
    throw new NotFoundError('Suscripción no encontrada');
  }

  const current = await withLazyExpiration(existing);
  if (current.status !== 'ACTIVE') {
    throw new ConflictError('Solo se puede modificar una suscripción activa');
  }

  if (input.endDate && input.endDate <= current.startDate) {
    throw new BadRequestError('endDate debe ser posterior a startDate');
  }

  const updated = await subscriptionsRepository.update(subId, {
    ...(input.status ? { status: input.status } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
  });

  return toDTO(updated);
}

export async function getCurrentSubscriptionForBusiness(
  businessId: string,
): Promise<SubscriptionDTO | null> {
  const subscription = await subscriptionsRepository.findCurrentActive(businessId);
  if (!subscription) {
    return null;
  }
  return toDTO(await withLazyExpiration(subscription));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

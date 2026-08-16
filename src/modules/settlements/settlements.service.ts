import { NotFoundError, ConflictError, ForbiddenError } from '../../shared/errors';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import { decimalToNumber } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';
import type { SettlementStatus, SettlementType } from '../../generated/prisma/enums';
import * as deliverersRepository from '../deliverers/deliverers.repository';
import * as settlementsRepository from './settlements.repository';
import type { SettlementWithRelations } from './settlements.repository';
import * as calc from './settlements.calculations';
import type { GenerateSettlementInput, ListSettlementsQuery } from './settlements.dto';

export interface SettlementDTO {
  id: string;
  type: SettlementType;
  delivererId: string;
  delivererName: string;
  periodStart: Date;
  periodEnd: Date;
  status: SettlementStatus;
  totalDeliveries: number;
  totalCollected: number;
  traeloDeliveryShare: number;
  delivererShare: number;
  platformFeeCollected: number;
  totalToDeliver: number;
  closedAt: Date | null;
  closedByUserId: string | null;
  closedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(settlement: SettlementWithRelations): SettlementDTO {
  return {
    id: settlement.id,
    type: settlement.type,
    delivererId: settlement.delivererId,
    delivererName: settlement.deliverer.user.name,
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    status: settlement.status,
    totalDeliveries: settlement.totalDeliveries,
    totalCollected: decimalToNumber(settlement.totalCollected),
    traeloDeliveryShare: decimalToNumber(settlement.traeloDeliveryShare),
    delivererShare: decimalToNumber(settlement.delivererShare),
    platformFeeCollected: decimalToNumber(settlement.platformFeeCollected),
    totalToDeliver: decimalToNumber(settlement.totalToDeliver),
    closedAt: settlement.closedAt,
    closedByUserId: settlement.closedByUserId,
    closedByName: settlement.closedBy?.name ?? null,
    createdAt: settlement.createdAt,
    updatedAt: settlement.updatedAt,
  };
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function startOfIsoWeek(date: Date): Date {
  const start = startOfDay(date);
  const day = start.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  start.setDate(start.getDate() + diffToMonday);
  return start;
}

function endOfIsoWeek(date: Date): Date {
  const start = startOfIsoWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return endOfDay(end);
}

async function generateSettlement(
  delivererId: string,
  type: SettlementType,
  periodStart: Date,
  periodEnd: Date,
): Promise<SettlementDTO> {
  const deliverer = await deliverersRepository.findById(delivererId);
  if (!deliverer) {
    throw new NotFoundError('Mensajero no encontrado');
  }

  const key = { delivererId, type, periodStart, periodEnd };
  const existing = await settlementsRepository.findByKey(key);
  if (existing && existing.status === 'CLOSED') {
    throw new ConflictError('Este cuadre ya está cerrado y no puede regenerarse');
  }

  const orders = await settlementsRepository.findEligibleOrders(
    delivererId,
    periodStart,
    periodEnd,
  );
  const totals = calc.computeSettlementTotals(orders);

  const settlement = await settlementsRepository.generateSettlementRecord(
    key,
    totals,
    orders.map((order) => order.id),
  );

  return toDTO(settlement);
}

export async function generateDailySettlement(
  input: GenerateSettlementInput,
): Promise<SettlementDTO> {
  const referenceDate = input.date ?? new Date();
  return generateSettlement(
    input.delivererId,
    'DAILY',
    startOfDay(referenceDate),
    endOfDay(referenceDate),
  );
}

export async function generateWeeklySettlement(
  input: GenerateSettlementInput,
): Promise<SettlementDTO> {
  const referenceDate = input.date ?? new Date();
  return generateSettlement(
    input.delivererId,
    'WEEKLY',
    startOfIsoWeek(referenceDate),
    endOfIsoWeek(referenceDate),
  );
}

export async function listSettlements(
  query: ListSettlementsQuery,
  scopeDelivererId?: string,
): Promise<{ data: SettlementDTO[]; meta: PaginationMeta }> {
  const where: Prisma.SettlementWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.delivererId ? { delivererId: query.delivererId } : {}),
    ...(scopeDelivererId ? { delivererId: scopeDelivererId } : {}),
  };

  const { skip, take } = toSkipTake(query);
  const [settlements, total] = await Promise.all([
    settlementsRepository.findMany(where, skip, take),
    settlementsRepository.count(where),
  ]);

  return { data: settlements.map(toDTO), meta: buildPaginationMeta(query, total) };
}

export async function getSettlementById(
  id: string,
  scopeDelivererId?: string,
): Promise<SettlementDTO> {
  const settlement = await settlementsRepository.findById(id);
  if (!settlement) {
    throw new NotFoundError('Cuadre no encontrado');
  }
  if (scopeDelivererId && settlement.delivererId !== scopeDelivererId) {
    throw new ForbiddenError();
  }
  return toDTO(settlement);
}

export async function closeSettlement(id: string, closedByUserId: string): Promise<SettlementDTO> {
  const existing = await settlementsRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Cuadre no encontrado');
  }
  if (existing.status === 'CLOSED') {
    throw new ConflictError('El cuadre ya está cerrado');
  }

  const settlement = await settlementsRepository.update(id, {
    status: 'CLOSED',
    closedAt: new Date(),
    closedBy: { connect: { id: closedByUserId } },
  });

  return toDTO(settlement);
}

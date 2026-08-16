import { NotFoundError, BadRequestError } from '../../shared/errors';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import { decimalToNumber } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';
import type { CommissionType } from '../../generated/prisma/enums';
import * as businessesRepository from './businesses.repository';
import * as subscriptionsService from './subscriptions.service';
import type { SubscriptionDTO } from './subscriptions.service';
import type {
  CreateBusinessInput,
  ListBusinessesQuery,
  UpdateBusinessInput,
} from './businesses.dto';

export interface BusinessDTO {
  id: string;
  name: string;
  phone: string;
  address: string;
  joinedAt: Date;
  active: boolean;
  commissionType: CommissionType;
  commissionPercentage: number | null;
  defaultProductCommissionAmount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BusinessDetailDTO extends BusinessDTO {
  currentSubscription: SubscriptionDTO | null;
}

interface BusinessRecord {
  id: string;
  name: string;
  phone: string;
  address: string;
  joinedAt: Date;
  active: boolean;
  commissionType: CommissionType;
  commissionPercentage: Prisma.Decimal | null;
  defaultProductCommissionAmount: Prisma.Decimal | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(business: BusinessRecord): BusinessDTO {
  return {
    id: business.id,
    name: business.name,
    phone: business.phone,
    address: business.address,
    joinedAt: business.joinedAt,
    active: business.active,
    commissionType: business.commissionType,
    commissionPercentage: decimalToNumber(business.commissionPercentage),
    defaultProductCommissionAmount: decimalToNumber(business.defaultProductCommissionAmount),
    createdAt: business.createdAt,
    updatedAt: business.updatedAt,
  };
}

export async function createBusiness(input: CreateBusinessInput): Promise<BusinessDTO> {
  const business = await businessesRepository.create({
    name: input.name,
    phone: input.phone,
    address: input.address,
    ...(input.joinedAt ? { joinedAt: input.joinedAt } : {}),
    commissionType: input.commissionType,
    commissionPercentage: input.commissionPercentage,
    defaultProductCommissionAmount: input.defaultProductCommissionAmount,
  });

  return toDTO(business);
}

export async function listBusinesses(
  query: ListBusinessesQuery,
): Promise<{ data: BusinessDTO[]; meta: PaginationMeta }> {
  const where: Prisma.BusinessWhereInput = {
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.commissionType ? { commissionType: query.commissionType } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };

  const { skip, take } = toSkipTake(query);
  const [businesses, total] = await Promise.all([
    businessesRepository.findMany(where, skip, take),
    businessesRepository.count(where),
  ]);

  return { data: businesses.map(toDTO), meta: buildPaginationMeta(query, total) };
}

export async function getBusinessById(id: string): Promise<BusinessDetailDTO> {
  const business = await businessesRepository.findById(id);
  if (!business) {
    throw new NotFoundError('Negocio no encontrado');
  }

  const currentSubscription = await subscriptionsService.getCurrentSubscriptionForBusiness(id);
  return { ...toDTO(business), currentSubscription };
}

export async function assertBusinessExists(id: string): Promise<BusinessRecord> {
  const business = await businessesRepository.findById(id);
  if (!business) {
    throw new NotFoundError('Negocio no encontrado');
  }
  return business;
}

export async function updateBusiness(id: string, input: UpdateBusinessInput): Promise<BusinessDTO> {
  const existing = await assertBusinessExists(id);

  const finalCommissionType = input.commissionType ?? existing.commissionType;
  const finalCommissionPercentage =
    input.commissionPercentage ?? decimalToNumber(existing.commissionPercentage) ?? undefined;
  const finalDefaultProductCommissionAmount =
    input.defaultProductCommissionAmount ??
    decimalToNumber(existing.defaultProductCommissionAmount) ??
    undefined;

  if (finalCommissionType === 'PERCENTAGE' && finalCommissionPercentage === undefined) {
    throw new BadRequestError(
      'commissionPercentage es requerido cuando commissionType es PERCENTAGE',
    );
  }
  if (
    finalCommissionType === 'FIXED_PER_PRODUCT' &&
    finalDefaultProductCommissionAmount === undefined
  ) {
    throw new BadRequestError(
      'defaultProductCommissionAmount es requerido cuando commissionType es FIXED_PER_PRODUCT',
    );
  }

  const business = await businessesRepository.update(id, input);
  return toDTO(business);
}

export async function deactivateBusiness(id: string): Promise<BusinessDTO> {
  await assertBusinessExists(id);
  const business = await businessesRepository.update(id, { active: false });
  return toDTO(business);
}

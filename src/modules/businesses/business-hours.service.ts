import { NotFoundError } from '../../shared/errors';
import { bumpCatalogVersion } from '../../shared/catalog';
import { timeToString } from '../../shared/time';
import { CatalogEntityType, CatalogChangeType } from '../../generated/prisma/enums';
import * as businessesRepository from './businesses.repository';
import * as businessHoursRepository from './business-hours.repository';
import type { UpsertBusinessHoursInput } from './business-hours.dto';

export interface BusinessHoursDTO {
  id: string;
  businessId: string;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  closed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface BusinessHoursRecord {
  id: string;
  businessId: string;
  dayOfWeek: number;
  openTime: Date;
  closeTime: Date;
  closed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(hours: BusinessHoursRecord): BusinessHoursDTO {
  return {
    id: hours.id,
    businessId: hours.businessId,
    dayOfWeek: hours.dayOfWeek,
    openTime: timeToString(hours.openTime),
    closeTime: timeToString(hours.closeTime),
    closed: hours.closed,
    createdAt: hours.createdAt,
    updatedAt: hours.updatedAt,
  };
}

async function assertBusinessExists(businessId: string): Promise<void> {
  const business = await businessesRepository.findById(businessId);
  if (!business) {
    throw new NotFoundError('Negocio no encontrado');
  }
}

export async function listBusinessHours(businessId: string): Promise<BusinessHoursDTO[]> {
  await assertBusinessExists(businessId);
  const hours = await businessHoursRepository.findManyForBusiness(businessId);
  return hours.map(toDTO);
}

export async function upsertBusinessHours(
  businessId: string,
  dayOfWeek: number,
  input: UpsertBusinessHoursInput,
): Promise<BusinessHoursDTO> {
  await assertBusinessExists(businessId);

  const hours = await businessHoursRepository.upsert(businessId, dayOfWeek, {
    openTime: input.openTime,
    closeTime: input.closeTime,
    closed: input.closed ?? false,
  });

  await bumpCatalogVersion(CatalogEntityType.BUSINESS_HOURS, hours.id, CatalogChangeType.UPSERT);
  return toDTO(hours);
}

export async function deleteBusinessHours(businessId: string, dayOfWeek: number): Promise<void> {
  await assertBusinessExists(businessId);

  const existing = await businessHoursRepository.findForDay(businessId, dayOfWeek);
  if (!existing) {
    throw new NotFoundError('No hay horario configurado para ese día');
  }

  await businessHoursRepository.deleteForDay(businessId, dayOfWeek);
  await bumpCatalogVersion(CatalogEntityType.BUSINESS_HOURS, existing.id, CatalogChangeType.DELETE);
}

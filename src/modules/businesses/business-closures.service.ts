import { ConflictError, NotFoundError } from '../../shared/errors';
import { bumpCatalogVersion } from '../../shared/catalog';
import { CatalogEntityType, CatalogChangeType } from '../../generated/prisma/enums';
import * as businessesRepository from './businesses.repository';
import * as closuresRepository from './business-closures.repository';
import type { CreateClosureInput, ListClosuresQuery } from './business-closures.dto';

export interface BusinessClosureDTO {
  id: string;
  businessId: string;
  date: Date;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

async function assertBusinessExists(businessId: string): Promise<void> {
  const business = await businessesRepository.findById(businessId);
  if (!business) {
    throw new NotFoundError('Negocio no encontrado');
  }
}

export async function listClosures(
  businessId: string,
  query: ListClosuresQuery,
): Promise<BusinessClosureDTO[]> {
  await assertBusinessExists(businessId);
  return closuresRepository.findManyForBusiness(businessId, query.upcoming ?? false);
}

export async function createClosure(
  businessId: string,
  input: CreateClosureInput,
): Promise<BusinessClosureDTO> {
  await assertBusinessExists(businessId);

  const existing = await closuresRepository.findByBusinessAndDate(businessId, input.date);
  if (existing) {
    throw new ConflictError('Ya existe un cierre registrado para ese negocio en esa fecha');
  }

  const closure = await closuresRepository.create({
    businessId,
    date: input.date,
    reason: input.reason,
  });

  await bumpCatalogVersion(
    CatalogEntityType.BUSINESS_CLOSURE,
    closure.id,
    CatalogChangeType.UPSERT,
  );
  return closure;
}

export async function deleteClosure(businessId: string, closureId: string): Promise<void> {
  await assertBusinessExists(businessId);

  const closure = await closuresRepository.findByIdForBusiness(closureId, businessId);
  if (!closure) {
    throw new NotFoundError('Cierre no encontrado');
  }

  await closuresRepository.deleteById(closureId);
  await bumpCatalogVersion(
    CatalogEntityType.BUSINESS_CLOSURE,
    closure.id,
    CatalogChangeType.DELETE,
  );
}

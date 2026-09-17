import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

export function getCatalogState() {
  return prisma.catalogState.findUnique({ where: { id: 'singleton' } });
}

export function findChangesSince(since: number, limit: number) {
  return prisma.catalogChangeLog.findMany({
    where: { version: { gt: since } },
    orderBy: { version: 'asc' },
    take: limit,
  });
}

// select explícito: nunca exponer commissionType/commissionPercentage/
// defaultProductCommissionAmount (datos internos del negocio) a la app pública.
const catalogBusinessSelect = {
  id: true,
  name: true,
  phone: true,
  address: true,
  acceptingOrders: true,
  logoUrl: true,
  updatedAt: true,
  businessHours: { orderBy: { dayOfWeek: 'asc' as const } },
} satisfies Prisma.BusinessSelect;

export function findCatalogBusinesses(search?: string) {
  return prisma.business.findMany({
    where: {
      active: true,
      acceptingOrders: true,
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    },
    select: catalogBusinessSelect,
    orderBy: { name: 'asc' },
  });
}

export function findCatalogBusinessById(businessId: string) {
  return prisma.business.findFirst({
    where: { id: businessId, active: true, acceptingOrders: true },
    select: catalogBusinessSelect,
  });
}

export function findCatalogProducts(
  businessId: string,
  options: { categoryId?: string; search?: string },
) {
  const now = new Date();
  return prisma.product.findMany({
    where: {
      businessId,
      active: true,
      available: true,
      ...(options.categoryId ? { categoryId: options.categoryId } : {}),
      ...(options.search
        ? { name: { contains: options.search, mode: 'insensitive' as const } }
        : {}),
    },
    include: {
      categoryRef: true,
      offers: {
        where: { active: true, startsAt: { lte: now }, endsAt: { gte: now } },
        orderBy: { startsAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  });
}

// Para GET /catalog/bootstrap: todos los productos vendibles de todos los negocios visibles
// en el catálogo, en una sola consulta (en vez de N llamadas, una por negocio).
export function findAllCatalogProducts() {
  const now = new Date();
  return prisma.product.findMany({
    where: {
      active: true,
      available: true,
      business: { active: true, acceptingOrders: true },
    },
    include: {
      categoryRef: true,
      offers: {
        where: { active: true, startsAt: { lte: now }, endsAt: { gte: now } },
        orderBy: { startsAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  });
}

// Cierres "relevantes" para el bootstrap: desde `from` en adelante, para el conjunto de
// negocios dado (batch, para no hacer una consulta por negocio).
export function findUpcomingClosures(businessIds: string[], from: Date) {
  return prisma.businessClosure.findMany({
    where: { businessId: { in: businessIds }, date: { gte: from } },
    orderBy: { date: 'asc' },
  });
}

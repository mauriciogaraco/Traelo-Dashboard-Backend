import { Prisma } from '../../generated/prisma/client';
import { logger } from '../../shared/logger';
import * as repository from './catalog-stats.repository';
import {
  buildCatalogStats,
  STATS_CACHE_TTL_MS,
  STATS_WINDOW_DAYS,
  type BusinessRatingRow,
  type CatalogStatsDTO,
} from './catalog-stats.rules';

let cache: { value: CatalogStatsDTO; expiresAt: number } | null = null;
let inFlight: Promise<CatalogStatsDTO> | null = null;

// Si la tabla de reseñas todavía no existe (migración sin aplicar) la popularidad sigue
// funcionando y solo faltan las calificaciones. Cualquier otro error SÍ se propaga.
async function safeRatings(): Promise<BusinessRatingRow[]> {
  try {
    return await repository.findBusinessRatings();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2021' || error.code === 'P2022')
    ) {
      logger.warn('Tabla de reseñas no disponible: se responden estadísticas sin calificaciones');
      return [];
    }
    throw error;
  }
}

async function compute(now: Date): Promise<CatalogStatsDTO> {
  const since = new Date(now.getTime() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [businessOrders, productUnits, businessRatings] = await Promise.all([
    repository.findBusinessOrderCounts(since),
    repository.findProductUnits(since),
    safeRatings(),
  ]);
  return buildCatalogStats({ businessOrders, productUnits, businessRatings }, now);
}

/**
 * Estadísticas para ordenar la búsqueda. Se calculan como mucho una vez cada 5 minutos por
 * proceso (y una sola consulta a la vez): la app las pide al abrir la búsqueda y no hace falta
 * que cada cliente dispare tres agregaciones sobre los pedidos.
 */
export async function getCatalogStats(now: Date = new Date()): Promise<CatalogStatsDTO> {
  if (cache && cache.expiresAt > now.getTime()) {
    return cache.value;
  }
  inFlight ??= compute(now)
    .then((value) => {
      cache = { value, expiresAt: now.getTime() + STATS_CACHE_TTL_MS };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Solo para tests. */
export function resetCatalogStatsCache(): void {
  cache = null;
  inFlight = null;
}

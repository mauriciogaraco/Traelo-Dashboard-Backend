// Estadísticas públicas del catálogo para ordenar la búsqueda de la app: qué negocios y productos
// son los más pedidos y cómo califican los clientes a los negocios. Solo datos agregados, nunca
// de personas ni montos.

/** Ventana de "popularidad": pedidos completados en los últimos N días (lo reciente pesa, no la historia). */
export const STATS_WINDOW_DAYS = 60;

/** Cuánto se reutiliza el cálculo antes de volver a consultar la base de datos. */
export const STATS_CACHE_TTL_MS = 5 * 60 * 1000;

export interface BusinessOrderCountRow {
  businessId: string;
  orders: number;
}

export interface BusinessRatingRow {
  businessId: string;
  average: number;
  count: number;
}

export interface ProductUnitsRow {
  productId: string;
  units: number;
}

export interface CatalogBusinessStatsDTO {
  businessId: string;
  /** Pedidos completados en la ventana. */
  orders: number;
  /** Promedio de reseñas (1.0–5.0, un decimal en la BD; aquí redondeado a 2) o null si no tiene. */
  ratingAverage: number | null;
  ratingCount: number;
}

export interface CatalogProductStatsDTO {
  productId: string;
  /** Unidades vendidas en pedidos completados dentro de la ventana. */
  units: number;
}

export interface CatalogStatsDTO {
  windowDays: number;
  generatedAt: Date;
  businesses: CatalogBusinessStatsDTO[];
  products: CatalogProductStatsDTO[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Une las tres consultas en un único DTO. Un negocio aparece si tiene pedidos O reseñas; un
 * producto solo si vendió algo. Los valores no finitos o negativos se descartan (defensivo).
 */
export function buildCatalogStats(
  input: {
    businessOrders: BusinessOrderCountRow[];
    businessRatings: BusinessRatingRow[];
    productUnits: ProductUnitsRow[];
  },
  now: Date = new Date(),
): CatalogStatsDTO {
  const businesses = new Map<string, CatalogBusinessStatsDTO>();
  const entryFor = (businessId: string): CatalogBusinessStatsDTO => {
    let entry = businesses.get(businessId);
    if (!entry) {
      entry = { businessId, orders: 0, ratingAverage: null, ratingCount: 0 };
      businesses.set(businessId, entry);
    }
    return entry;
  };

  for (const row of input.businessOrders) {
    if (Number.isFinite(row.orders) && row.orders > 0) {
      entryFor(row.businessId).orders = Math.floor(row.orders);
    }
  }
  for (const row of input.businessRatings) {
    if (Number.isFinite(row.average) && row.count > 0) {
      const entry = entryFor(row.businessId);
      entry.ratingAverage = round2(row.average);
      entry.ratingCount = Math.floor(row.count);
    }
  }

  const products: CatalogProductStatsDTO[] = input.productUnits
    .filter((row) => Number.isFinite(row.units) && row.units > 0)
    .map((row) => ({ productId: row.productId, units: Math.floor(row.units) }));

  return {
    windowDays: STATS_WINDOW_DAYS,
    generatedAt: now,
    businesses: [...businesses.values()],
    products,
  };
}

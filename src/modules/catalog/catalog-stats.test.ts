import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { buildCatalogStats, STATS_CACHE_TTL_MS, STATS_WINDOW_DAYS } from './catalog-stats.rules';

const repo = vi.hoisted(() => ({
  findBusinessOrderCounts: vi.fn(),
  findProductUnits: vi.fn(),
  findBusinessRatings: vi.fn(),
}));
vi.mock('./catalog-stats.repository', () => repo);

import { getCatalogStats, resetCatalogStatsCache } from './catalog-stats.service';

describe('buildCatalogStats', () => {
  it('une pedidos y reseñas por negocio y unidades por producto', () => {
    const stats = buildCatalogStats(
      {
        businessOrders: [
          { businessId: 'b1', orders: 40 },
          { businessId: 'b2', orders: 5 },
        ],
        businessRatings: [
          { businessId: 'b1', average: 4.666, count: 12 },
          { businessId: 'b3', average: 3.5, count: 2 },
        ],
        productUnits: [{ productId: 'p1', units: 90 }],
      },
      new Date('2026-09-20T00:00:00Z'),
    );

    expect(stats.windowDays).toBe(STATS_WINDOW_DAYS);
    expect(stats.businesses).toEqual([
      { businessId: 'b1', orders: 40, ratingAverage: 4.67, ratingCount: 12 },
      { businessId: 'b2', orders: 5, ratingAverage: null, ratingCount: 0 },
      { businessId: 'b3', orders: 0, ratingAverage: 3.5, ratingCount: 2 },
    ]);
    expect(stats.products).toEqual([{ productId: 'p1', units: 90 }]);
  });

  it('descarta valores vacíos, negativos o no finitos', () => {
    const stats = buildCatalogStats({
      businessOrders: [
        { businessId: 'b1', orders: 0 },
        { businessId: 'b2', orders: -3 },
        { businessId: 'b3', orders: Number.NaN },
      ],
      businessRatings: [{ businessId: 'b4', average: 5, count: 0 }],
      productUnits: [
        { productId: 'p1', units: 0 },
        { productId: 'p2', units: Number.POSITIVE_INFINITY },
      ],
    });
    expect(stats.businesses).toEqual([]);
    expect(stats.products).toEqual([]);
  });

  it('no incluye montos, personas ni nada más que conteos y promedios', () => {
    const stats = buildCatalogStats({
      businessOrders: [{ businessId: 'b1', orders: 3 }],
      businessRatings: [{ businessId: 'b1', average: 4, count: 3 }],
      productUnits: [{ productId: 'p1', units: 3 }],
    });
    expect(Object.keys(stats.businesses[0] ?? {}).sort()).toEqual([
      'businessId',
      'orders',
      'ratingAverage',
      'ratingCount',
    ]);
    expect(Object.keys(stats.products[0] ?? {}).sort()).toEqual(['productId', 'units']);
  });
});

describe('getCatalogStats (caché)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCatalogStatsCache();
    repo.findBusinessOrderCounts.mockResolvedValue([{ businessId: 'b1', orders: 3 }]);
    repo.findProductUnits.mockResolvedValue([{ productId: 'p1', units: 7 }]);
    repo.findBusinessRatings.mockResolvedValue([{ businessId: 'b1', average: 4.5, count: 4 }]);
  });

  it('consulta una vez y reutiliza el resultado dentro de la ventana de caché', async () => {
    const t0 = new Date('2026-09-20T12:00:00Z');
    const first = await getCatalogStats(t0);
    const second = await getCatalogStats(new Date(t0.getTime() + STATS_CACHE_TTL_MS - 1000));

    expect(second).toBe(first);
    expect(repo.findBusinessOrderCounts).toHaveBeenCalledTimes(1);
  });

  it('pasado el TTL vuelve a consultar', async () => {
    const t0 = new Date('2026-09-20T12:00:00Z');
    await getCatalogStats(t0);
    await getCatalogStats(new Date(t0.getTime() + STATS_CACHE_TTL_MS + 1));
    expect(repo.findBusinessOrderCounts).toHaveBeenCalledTimes(2);
  });

  it('peticiones simultáneas comparten UN solo cálculo', async () => {
    await Promise.all([getCatalogStats(), getCatalogStats(), getCatalogStats()]);
    expect(repo.findBusinessOrderCounts).toHaveBeenCalledTimes(1);
  });

  it('la ventana de popularidad son los últimos 60 días', async () => {
    const now = new Date('2026-09-20T12:00:00Z');
    await getCatalogStats(now);
    const since = repo.findBusinessOrderCounts.mock.calls[0]?.[0] as Date;
    expect((now.getTime() - since.getTime()) / 86_400_000).toBe(STATS_WINDOW_DAYS);
  });

  it('si la tabla de reseñas no existe todavía (migración pendiente), responde sin calificaciones', async () => {
    repo.findBusinessRatings.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing table', {
        code: 'P2021',
        clientVersion: 'test',
      }),
    );

    const stats = await getCatalogStats();

    expect(stats.businesses).toEqual([
      { businessId: 'b1', orders: 3, ratingAverage: null, ratingCount: 0 },
    ]);
    expect(stats.products).toHaveLength(1);
  });

  it('cualquier otro error SÍ se propaga y no queda cacheado', async () => {
    repo.findProductUnits.mockRejectedValueOnce(new Error('BD caída'));
    await expect(getCatalogStats()).rejects.toThrow('BD caída');

    repo.findProductUnits.mockResolvedValue([]);
    await expect(getCatalogStats()).resolves.toBeTruthy();
  });
});

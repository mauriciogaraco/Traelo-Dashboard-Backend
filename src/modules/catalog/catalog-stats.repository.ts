import { prisma } from '../../shared/prisma';
import { decimalToNumber } from '../../shared/prisma';
import type {
  BusinessOrderCountRow,
  BusinessRatingRow,
  ProductUnitsRow,
} from './catalog-stats.rules';

export async function findBusinessOrderCounts(since: Date): Promise<BusinessOrderCountRow[]> {
  const rows = await prisma.orderBusiness.groupBy({
    by: ['businessId'],
    where: { order: { status: 'COMPLETED', completedAt: { gte: since } } },
    _count: { _all: true },
  });
  return rows.map((row) => ({ businessId: row.businessId, orders: row._count._all }));
}

export async function findProductUnits(since: Date): Promise<ProductUnitsRow[]> {
  const rows = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: {
      productId: { not: null },
      orderBusiness: { order: { status: 'COMPLETED', completedAt: { gte: since } } },
    },
    _sum: { quantity: true },
  });
  return rows
    .filter((row): row is typeof row & { productId: string } => row.productId !== null)
    .map((row) => ({ productId: row.productId, units: row._sum.quantity ?? 0 }));
}

// Todas las reseñas (no solo la ventana): la calidad de un negocio no caduca a los 60 días.
export async function findBusinessRatings(): Promise<BusinessRatingRow[]> {
  const rows = await prisma.businessReview.groupBy({
    by: ['businessId'],
    _avg: { rating: true },
    _count: { _all: true },
  });
  return rows.map((row) => ({
    businessId: row.businessId,
    average: row._avg.rating === null ? 0 : decimalToNumber(row._avg.rating),
    count: row._count._all,
  }));
}

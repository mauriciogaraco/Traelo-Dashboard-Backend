import { prisma } from '../../shared/prisma';

export function findOrderForReview(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      customerId: true,
      delivererId: true,
      completedAt: true,
      deliverer: { select: { user: { select: { name: true } } } },
      businesses: {
        select: {
          businessId: true,
          businessNameSnapshot: true,
          business: { select: { name: true } },
        },
      },
      delivererReview: { select: { rating: true } },
      businessReviews: { select: { businessId: true, rating: true } },
    },
  });
}

export type OrderForReview = NonNullable<Awaited<ReturnType<typeof findOrderForReview>>>;

export function createDelivererReview(data: {
  orderId: string;
  delivererId: string;
  customerId: string | null;
  rating: number;
}) {
  return prisma.delivererReview.create({ data });
}

// Todo o nada: si alguna reseña falla (p. ej. duplicada por una carrera), no se crea ninguna.
export function createBusinessReviews(
  orderId: string,
  customerId: string | null,
  reviews: { businessId: string; rating: number }[],
) {
  return prisma.$transaction(
    reviews.map((review) =>
      prisma.businessReview.create({
        data: { orderId, businessId: review.businessId, customerId, rating: review.rating },
      }),
    ),
  );
}

// Pedidos COMPLETED de un cliente desde `since` a los que todavía les falta alguna reseña.
export function findOrdersPendingReview(customerId: string, since: Date, take: number) {
  return prisma.order.findMany({
    where: {
      customerId,
      status: 'COMPLETED',
      completedAt: { gte: since },
      OR: [
        { delivererId: { not: null }, delivererReview: { is: null } },
        { businesses: { some: { review: { is: null } } } },
      ],
    },
    orderBy: { completedAt: 'desc' },
    take,
    select: {
      id: true,
      orderNumber: true,
      completedAt: true,
      delivererId: true,
      deliverer: { select: { user: { select: { name: true } } } },
      businesses: {
        select: {
          businessId: true,
          businessNameSnapshot: true,
          business: { select: { name: true } },
          review: { select: { id: true } },
        },
      },
      delivererReview: { select: { id: true } },
    },
  });
}

export function aggregateDelivererRating(delivererId: string) {
  return prisma.delivererReview.aggregate({
    where: { delivererId },
    _avg: { rating: true },
    _count: { _all: true },
  });
}

export function aggregateBusinessRating(businessId: string) {
  return prisma.businessReview.aggregate({
    where: { businessId },
    _avg: { rating: true },
    _count: { _all: true },
  });
}

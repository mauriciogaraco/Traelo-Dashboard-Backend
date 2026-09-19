// Doble en memoria de reviews.repository, SOLO para tests (se inyecta con vi.mock). Imita las
// restricciones reales de la BD: unique (orderId) del mensajero, unique (orderId, businessId)
// de negocio, FK compuesta pedido↔negocio y agregados de promedio/cantidad.
import { Prisma } from '../../generated/prisma/client';

export interface FakeOrder {
  id: string;
  orderNumber: number;
  status: 'PENDING' | 'ASSIGNED' | 'COMPLETED' | 'CANCELLED';
  customerId: string | null;
  delivererId: string | null;
  delivererName: string | null;
  completedAt: Date | null;
  businesses: { businessId: string; name: string }[];
}

interface StoredDelivererReview {
  orderId: string;
  delivererId: string;
  customerId: string | null;
  rating: number;
}

interface StoredBusinessReview {
  orderId: string;
  businessId: string;
  customerId: string | null;
  rating: number;
}

const decimal = (value: number) => new Prisma.Decimal(value);

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

export function createFakeReviewsRepository() {
  const state = {
    orders: new Map<string, FakeOrder>(),
    delivererReviews: [] as StoredDelivererReview[],
    businessReviews: [] as StoredBusinessReview[],
  };

  const api = {
    state,

    seedOrder(order: FakeOrder) {
      state.orders.set(order.id, order);
      return order;
    },

    async findOrderForReview(orderId: string) {
      const order = state.orders.get(orderId);
      if (!order) {
        return null;
      }
      const delivererReview = state.delivererReviews.find((r) => r.orderId === orderId);
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        customerId: order.customerId,
        delivererId: order.delivererId,
        completedAt: order.completedAt,
        deliverer: order.delivererId
          ? { user: { name: order.delivererName ?? 'Mensajero' } }
          : null,
        businesses: order.businesses.map((business) => ({
          businessId: business.businessId,
          businessNameSnapshot: business.name,
          business: { name: `${business.name} (actual)` },
        })),
        delivererReview: delivererReview ? { rating: decimal(delivererReview.rating) } : null,
        businessReviews: state.businessReviews
          .filter((r) => r.orderId === orderId)
          .map((r) => ({ businessId: r.businessId, rating: decimal(r.rating) })),
      };
    },

    async createDelivererReview(data: StoredDelivererReview) {
      if (state.delivererReviews.some((r) => r.orderId === data.orderId)) {
        throw uniqueViolation();
      }
      state.delivererReviews.push(data);
      return data;
    },

    // Atómico: valida todo antes de insertar (como la transacción real).
    async createBusinessReviews(
      orderId: string,
      customerId: string | null,
      reviews: { businessId: string; rating: number }[],
    ) {
      const order = state.orders.get(orderId);
      for (const review of reviews) {
        if (!order?.businesses.some((b) => b.businessId === review.businessId)) {
          throw new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
            code: 'P2003',
            clientVersion: 'test',
          });
        }
        if (
          state.businessReviews.some(
            (r) => r.orderId === orderId && r.businessId === review.businessId,
          )
        ) {
          throw uniqueViolation();
        }
      }
      for (const review of reviews) {
        state.businessReviews.push({ orderId, customerId, ...review });
      }
    },

    async findOrdersPendingReview(customerId: string, since: Date, take: number) {
      return [...state.orders.values()]
        .filter(
          (order) =>
            order.customerId === customerId &&
            order.status === 'COMPLETED' &&
            order.completedAt !== null &&
            order.completedAt >= since,
        )
        .map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          completedAt: order.completedAt,
          delivererId: order.delivererId,
          deliverer: order.delivererId
            ? { user: { name: order.delivererName ?? 'Mensajero' } }
            : null,
          businesses: order.businesses.map((business) => ({
            businessId: business.businessId,
            businessNameSnapshot: business.name,
            business: { name: business.name },
            review: state.businessReviews.some(
              (r) => r.orderId === order.id && r.businessId === business.businessId,
            )
              ? { id: 'r' }
              : null,
          })),
          delivererReview: state.delivererReviews.some((r) => r.orderId === order.id)
            ? { id: 'r' }
            : null,
        }))
        .filter(
          (order) =>
            (order.delivererId !== null && order.delivererReview === null) ||
            order.businesses.some((business) => business.review === null),
        )
        .slice(0, take);
    },

    async aggregateDelivererRating(delivererId: string) {
      const rows = state.delivererReviews.filter((r) => r.delivererId === delivererId);
      return aggregate(rows.map((r) => r.rating));
    },

    async aggregateBusinessRating(businessId: string) {
      const rows = state.businessReviews.filter((r) => r.businessId === businessId);
      return aggregate(rows.map((r) => r.rating));
    },
  };

  return api;
}

function aggregate(ratings: number[]) {
  const sum = ratings.reduce((acc, value) => acc + value, 0);
  return {
    _avg: { rating: ratings.length ? decimal(sum / ratings.length) : null },
    _count: { _all: ratings.length },
  };
}

export type FakeReviewsRepository = ReturnType<typeof createFakeReviewsRepository>;

export const fakeReviewsHolder: { current: FakeReviewsRepository } = {
  current: createFakeReviewsRepository(),
};

const REPOSITORY_FUNCTIONS = [
  'findOrderForReview',
  'createDelivererReview',
  'createBusinessReviews',
  'findOrdersPendingReview',
  'aggregateDelivererRating',
  'aggregateBusinessRating',
] as const;

// Uso: vi.mock('./reviews.repository', () => delegatingReviewsRepositoryModule());
export function delegatingReviewsRepositoryModule(): Record<string, (...args: never[]) => unknown> {
  return Object.fromEntries(
    REPOSITORY_FUNCTIONS.map((name) => [
      name,
      (...args: unknown[]) =>
        (fakeReviewsHolder.current[name] as (...a: unknown[]) => unknown)(...args),
    ]),
  );
}

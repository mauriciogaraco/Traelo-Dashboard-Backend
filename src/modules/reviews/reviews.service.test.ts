import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../shared/errors';
// Debe importarse antes que reviews.service (ver vi.mock).
import {
  createFakeReviewsRepository,
  delegatingReviewsRepositoryModule,
  fakeReviewsHolder,
  type FakeOrder,
} from './fake-reviews.repository';
import * as service from './reviews.service';

vi.mock('./reviews.repository', () => delegatingReviewsRepositoryModule());

const CUSTOMER = 'ccustomer00000000000001';
const OTHER_CUSTOMER = 'ccustomer00000000000002';
const DELIVERER = 'cdeliverer0000000000001';
const BIZ_A = 'cbusiness0000000000000a';
const BIZ_B = 'cbusiness0000000000000b';
const BIZ_OUTSIDE = 'cbusiness0000000000000z';

const asCustomer = { kind: 'customer', customerId: CUSTOMER } as const;
const asGuest = { kind: 'guest' } as const;

function order(overrides: Partial<FakeOrder> & { id: string }): FakeOrder {
  return fakeReviewsHolder.current.seedOrder({
    orderNumber: 101,
    status: 'COMPLETED',
    customerId: CUSTOMER,
    delivererId: DELIVERER,
    delivererName: 'Yoandry',
    completedAt: new Date(),
    businesses: [{ businessId: BIZ_A, name: 'Pizzería' }],
    ...overrides,
  });
}

async function expectAppError(promise: Promise<unknown>, statusCode: number, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).statusCode).toBe(statusCode);
  expect((error as AppError).code).toBe(code);
}

beforeEach(() => {
  fakeReviewsHolder.current = createFakeReviewsRepository();
});

describe('estado de reseñas de un pedido', () => {
  it('pedido completado sin reseñas: todo pending, canReview y hasPending', async () => {
    order({
      id: 'o1',
      businesses: [
        { businessId: BIZ_A, name: 'Pizzería' },
        { businessId: BIZ_B, name: 'Dulcería' },
      ],
    });

    const state = await service.getOrderReviews(asCustomer, 'o1');

    expect(state.canReview).toBe(true);
    expect(state.hasPending).toBe(true);
    expect(state.deliverer).toEqual({ delivererName: 'Yoandry', status: 'pending', rating: null });
    expect(state.businesses.map((b) => [b.businessId, b.status])).toEqual([
      [BIZ_A, 'pending'],
      [BIZ_B, 'pending'],
    ]);
  });

  it('pedido no completado: canReview=false y hasPending=false', async () => {
    order({ id: 'o1', status: 'ASSIGNED', completedAt: null });
    const state = await service.getOrderReviews(asCustomer, 'o1');
    expect(state.canReview).toBe(false);
    expect(state.hasPending).toBe(false);
  });

  it('sin mensajero asignado: deliverer=null', async () => {
    order({ id: 'o1', delivererId: null, delivererName: null });
    const state = await service.getOrderReviews(asCustomer, 'o1');
    expect(state.deliverer).toBeNull();
  });

  it('usa el nombre del negocio congelado en el pedido (no el actual)', async () => {
    order({ id: 'o1' });
    const state = await service.getOrderReviews(asCustomer, 'o1');
    expect(state.businesses[0]?.businessName).toBe('Pizzería');
  });
});

describe('valorar al mensajero', () => {
  it('reseña válida: se guarda con el mensajero DEL PEDIDO y el estado pasa a submitted', async () => {
    order({ id: 'o1' });

    const state = await service.submitDelivererReview(asCustomer, 'o1', { rating: 4.7 });

    expect(state.deliverer).toEqual({ delivererName: 'Yoandry', status: 'submitted', rating: 4.7 });
    expect(fakeReviewsHolder.current.state.delivererReviews).toEqual([
      { orderId: 'o1', delivererId: DELIVERER, customerId: CUSTOMER, rating: 4.7 },
    ]);
  });

  it('acepta los extremos 1.0 y 5.0', async () => {
    order({ id: 'o1' });
    order({ id: 'o2', orderNumber: 102 });
    await expect(
      service.submitDelivererReview(asCustomer, 'o1', { rating: 1 }),
    ).resolves.toBeTruthy();
    await expect(
      service.submitDelivererReview(asCustomer, 'o2', { rating: 5 }),
    ).resolves.toBeTruthy();
  });

  it('pedido NO completado (pendiente/asignado/cancelado) → 409 ORDER_NOT_COMPLETED', async () => {
    for (const status of ['PENDING', 'ASSIGNED', 'CANCELLED'] as const) {
      order({ id: `o-${status}`, status, completedAt: null });
      await expectAppError(
        service.submitDelivererReview(asCustomer, `o-${status}`, { rating: 5 }),
        409,
        'ORDER_NOT_COMPLETED',
      );
    }
    expect(fakeReviewsHolder.current.state.delivererReviews).toHaveLength(0);
  });

  it('pedido AJENO → 404 y no se escribe nada', async () => {
    order({ id: 'o1', customerId: OTHER_CUSTOMER });
    await expectAppError(
      service.submitDelivererReview(asCustomer, 'o1', { rating: 5 }),
      404,
      'ORDER_NOT_FOUND',
    );
    expect(fakeReviewsHolder.current.state.delivererReviews).toHaveLength(0);
  });

  it('un invitado no puede valorar un pedido de cuenta, ni una cuenta el de un invitado', async () => {
    order({ id: 'account-order', customerId: CUSTOMER });
    order({ id: 'guest-order', customerId: null });

    await expectAppError(
      service.submitDelivererReview(asGuest, 'account-order', { rating: 5 }),
      404,
      'ORDER_NOT_FOUND',
    );
    await expectAppError(
      service.submitDelivererReview(asCustomer, 'guest-order', { rating: 5 }),
      404,
      'ORDER_NOT_FOUND',
    );
  });

  it('un invitado (con pedido de invitado) valora y la reseña queda sin customerId', async () => {
    order({ id: 'guest-order', customerId: null });
    await service.submitDelivererReview(asGuest, 'guest-order', { rating: 3.5 });
    expect(fakeReviewsHolder.current.state.delivererReviews[0]).toMatchObject({
      customerId: null,
      rating: 3.5,
    });
  });

  it('pedido sin mensajero → 409 NO_DELIVERER (no se puede inventar uno)', async () => {
    order({ id: 'o1', delivererId: null, delivererName: null });
    await expectAppError(
      service.submitDelivererReview(asCustomer, 'o1', { rating: 5 }),
      409,
      'NO_DELIVERER',
    );
  });

  it('duplicado → 409 REVIEW_ALREADY_SUBMITTED y la primera valoración no cambia', async () => {
    order({ id: 'o1' });
    await service.submitDelivererReview(asCustomer, 'o1', { rating: 4.2 });

    await expectAppError(
      service.submitDelivererReview(asCustomer, 'o1', { rating: 1 }),
      409,
      'REVIEW_ALREADY_SUBMITTED',
    );
    expect(fakeReviewsHolder.current.state.delivererReviews).toHaveLength(1);
    expect(fakeReviewsHolder.current.state.delivererReviews[0]?.rating).toBe(4.2);
  });

  it('carrera: si el unique de la BD rechaza el segundo insert, también es 409 (no 500)', async () => {
    order({ id: 'o1' });
    const repo = fakeReviewsHolder.current;
    const realFind = repo.findOrderForReview.bind(repo);
    // Ambas requests leen "sin reseña" antes de que la primera escriba.
    repo.findOrderForReview = async (id: string) => {
      const found = await realFind(id);
      return found ? { ...found, delivererReview: null } : found;
    };

    await service.submitDelivererReview(asCustomer, 'o1', { rating: 5 });
    await expectAppError(
      service.submitDelivererReview(asCustomer, 'o1', { rating: 4 }),
      409,
      'REVIEW_ALREADY_SUBMITTED',
    );
  });
});

describe('valorar negocios', () => {
  it('pedido de un negocio: reseña válida', async () => {
    order({ id: 'o1' });
    const state = await service.submitBusinessReviews(asCustomer, 'o1', {
      reviews: [{ businessId: BIZ_A, rating: 4.4 }],
    });
    expect(state.businesses[0]).toMatchObject({
      businessId: BIZ_A,
      status: 'submitted',
      rating: 4.4,
    });
    expect(state.hasPending).toBe(true); // falta el mensajero
  });

  it('pedido con VARIOS negocios: una reseña por negocio, con ratings distintos', async () => {
    order({
      id: 'o1',
      businesses: [
        { businessId: BIZ_A, name: 'Pizzería' },
        { businessId: BIZ_B, name: 'Dulcería' },
      ],
    });

    const state = await service.submitBusinessReviews(asCustomer, 'o1', {
      reviews: [
        { businessId: BIZ_A, rating: 5 },
        { businessId: BIZ_B, rating: 2.5 },
      ],
    });

    expect(state.businesses.map((b) => [b.businessId, b.rating])).toEqual([
      [BIZ_A, 5],
      [BIZ_B, 2.5],
    ]);
  });

  it('se puede valorar un negocio ahora y el otro después', async () => {
    order({
      id: 'o1',
      businesses: [
        { businessId: BIZ_A, name: 'Pizzería' },
        { businessId: BIZ_B, name: 'Dulcería' },
      ],
    });
    await service.submitBusinessReviews(asCustomer, 'o1', {
      reviews: [{ businessId: BIZ_A, rating: 5 }],
    });
    const state = await service.submitBusinessReviews(asCustomer, 'o1', {
      reviews: [{ businessId: BIZ_B, rating: 3 }],
    });
    expect(state.businesses.every((b) => b.status === 'submitted')).toBe(true);
  });

  it('un negocio que NO pertenece al pedido → 400 BUSINESS_NOT_IN_ORDER y NO se guarda ninguna', async () => {
    order({ id: 'o1' });
    await expectAppError(
      service.submitBusinessReviews(asCustomer, 'o1', {
        reviews: [
          { businessId: BIZ_A, rating: 5 },
          { businessId: BIZ_OUTSIDE, rating: 5 },
        ],
      }),
      400,
      'BUSINESS_NOT_IN_ORDER',
    );
    expect(fakeReviewsHolder.current.state.businessReviews).toHaveLength(0);
  });

  it('pedido no completado → 409; pedido ajeno → 404', async () => {
    order({ id: 'o-active', status: 'ASSIGNED', completedAt: null });
    order({ id: 'o-other', customerId: OTHER_CUSTOMER });
    const input = { reviews: [{ businessId: BIZ_A, rating: 5 }] };

    await expectAppError(
      service.submitBusinessReviews(asCustomer, 'o-active', input),
      409,
      'ORDER_NOT_COMPLETED',
    );
    await expectAppError(
      service.submitBusinessReviews(asCustomer, 'o-other', input),
      404,
      'ORDER_NOT_FOUND',
    );
  });

  it('duplicado de un negocio → 409 y, en un envío mixto, tampoco se guarda el negocio nuevo (atómico)', async () => {
    order({
      id: 'o1',
      businesses: [
        { businessId: BIZ_A, name: 'Pizzería' },
        { businessId: BIZ_B, name: 'Dulcería' },
      ],
    });
    await service.submitBusinessReviews(asCustomer, 'o1', {
      reviews: [{ businessId: BIZ_A, rating: 5 }],
    });

    await expectAppError(
      service.submitBusinessReviews(asCustomer, 'o1', {
        reviews: [
          { businessId: BIZ_A, rating: 1 },
          { businessId: BIZ_B, rating: 4 },
        ],
      }),
      409,
      'REVIEW_ALREADY_SUBMITTED',
    );
    expect(fakeReviewsHolder.current.state.businessReviews).toHaveLength(1);
  });
});

describe('estado final: cuando todo está valorado', () => {
  it('hasPending pasa a false', async () => {
    order({ id: 'o1' });
    await service.submitDelivererReview(asCustomer, 'o1', { rating: 5 });
    const state = await service.submitBusinessReviews(asCustomer, 'o1', {
      reviews: [{ businessId: BIZ_A, rating: 4 }],
    });
    expect(state.hasPending).toBe(false);
  });
});

describe('pendientes de valorar', () => {
  it('lista solo pedidos completados recientes del cliente con algo pendiente', async () => {
    const now = new Date('2026-09-18T12:00:00Z');
    order({ id: 'reciente', completedAt: new Date('2026-09-17T12:00:00Z') });
    order({ id: 'viejo', completedAt: new Date('2026-08-01T12:00:00Z') });
    order({
      id: 'ajeno',
      customerId: OTHER_CUSTOMER,
      completedAt: new Date('2026-09-17T12:00:00Z'),
    });
    order({ id: 'activo', status: 'ASSIGNED', completedAt: null });
    order({ id: 'completo', completedAt: new Date('2026-09-17T13:00:00Z') });
    await service.submitDelivererReview(asCustomer, 'completo', { rating: 5 });
    await service.submitBusinessReviews(asCustomer, 'completo', {
      reviews: [{ businessId: BIZ_A, rating: 5 }],
    });

    const pending = await service.listPendingReviews(CUSTOMER, now);

    expect(pending.map((p) => p.orderId)).toEqual(['reciente']);
    expect(pending[0]).toMatchObject({
      delivererPending: { delivererName: 'Yoandry' },
      businessesPending: [{ businessId: BIZ_A, businessName: 'Pizzería' }],
    });
  });
});

describe('promedio y conteo', () => {
  it('mensajero: promedio y cantidad de todas sus reseñas', async () => {
    for (const [id, rating] of [
      ['o1', 5],
      ['o2', 4],
      ['o3', 4.5],
    ] as const) {
      order({ id, orderNumber: Number(id.slice(1)) });
      await service.submitDelivererReview(asCustomer, id, { rating });
    }

    expect(await service.getDelivererRatingSummary(DELIVERER)).toEqual({ average: 4.5, count: 3 });
  });

  it('negocio: promedio y cantidad, redondeado a 2 decimales', async () => {
    for (const [id, rating] of [
      ['o1', 5],
      ['o2', 4],
      ['o3', 4],
    ] as const) {
      order({ id, orderNumber: Number(id.slice(1)) });
      await service.submitBusinessReviews(asCustomer, id, {
        reviews: [{ businessId: BIZ_A, rating }],
      });
    }

    expect(await service.getBusinessRatingSummary(BIZ_A)).toEqual({ average: 4.33, count: 3 });
  });

  it('sin reseñas: average null y count 0', async () => {
    expect(await service.getDelivererRatingSummary(DELIVERER)).toEqual({ average: null, count: 0 });
    expect(await service.getBusinessRatingSummary(BIZ_A)).toEqual({ average: null, count: 0 });
  });
});

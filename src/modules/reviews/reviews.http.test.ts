// Pruebas HTTP de las reseñas: rutas de cliente (/customers/me/...) y de invitado
// (/guest/orders/... con X-Guest-Token), autorización, IDOR y validación del body.
// Repositorio de reseñas y servicio de pedidos simulados: no requieren base de datos.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../middlewares/errorHandler';
import { hashToken } from '../auth/token.service';
import { signCustomerAccessToken } from '../customer-auth/customer-token.service';
// Debe importarse antes que los routers (ver vi.mock).
import {
  createFakeReviewsRepository,
  delegatingReviewsRepositoryModule,
  fakeReviewsHolder,
} from './fake-reviews.repository';
import { customersRouter } from '../customers/customers.routes';
import { guestOrdersRouter } from '../guest-orders/guest-orders.routes';

vi.mock('./reviews.repository', () => delegatingReviewsRepositoryModule());
vi.mock('../../middlewares/apiKeyAuth', () => ({
  apiKeyAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// El middleware de invitado busca el pedido por el hash del token.
const guestHashes = vi.hoisted(() => new Map<string, { id: string; customerId: string | null }>());
vi.mock('../orders/orders.service', () => ({
  findOrderByGuestAccessTokenHash: vi.fn(async (hash: string) => guestHashes.get(hash) ?? null),
}));

const ME = 'ccustomer00000000000001';
const OTHER = 'ccustomer00000000000002';
const DELIVERER = 'cdeliverer0000000000001';
const BIZ_A = 'cbusiness0000000000000a';
const BIZ_B = 'cbusiness0000000000000b';
const ORDER = 'corder00000000000000001';
const OTHERS_ORDER = 'corder00000000000000002';
const ACTIVE_ORDER = 'corder00000000000000003';
const GUEST_ORDER = 'corder00000000000000004';
const GUEST_TOKEN = 'a'.repeat(64);

let server: Server;
let baseUrl: string;

async function call(
  method: string,
  path: string,
  options: { body?: unknown; token?: string; guestToken?: string } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.guestToken ? { 'x-guest-token': options.guestToken } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: Record<string, any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    json = text ? (JSON.parse(text) as Record<string, any>) : null; // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch {
    // Respuesta no JSON.
  }
  return { status: response.status, json };
}

const myToken = () => signCustomerAccessToken(ME);

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/customers', customersRouter);
  app.use('/api/v1/guest/orders', guestOrdersRouter);
  app.use(errorHandler);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  const repo = createFakeReviewsRepository();
  fakeReviewsHolder.current = repo;
  const base = {
    orderNumber: 1,
    status: 'COMPLETED' as const,
    delivererId: DELIVERER,
    delivererName: 'Yoandry',
    completedAt: new Date(),
    businesses: [
      { businessId: BIZ_A, name: 'Pizzería' },
      { businessId: BIZ_B, name: 'Dulcería' },
    ],
  };
  repo.seedOrder({ ...base, id: ORDER, customerId: ME });
  repo.seedOrder({ ...base, id: OTHERS_ORDER, customerId: OTHER });
  repo.seedOrder({
    ...base,
    id: ACTIVE_ORDER,
    customerId: ME,
    status: 'ASSIGNED',
    completedAt: null,
  });
  repo.seedOrder({ ...base, id: GUEST_ORDER, customerId: null });

  guestHashes.clear();
  guestHashes.set(hashToken(GUEST_TOKEN), { id: GUEST_ORDER, customerId: null });
});

describe('reseñas con cuenta (/customers/me)', () => {
  it('GET devuelve el estado pending/submitted calculado por el backend', async () => {
    const result = await call('GET', `/api/v1/customers/me/orders/${ORDER}/reviews`, {
      token: myToken(),
    });
    expect(result.status).toBe(200);
    expect(result.json?.data).toMatchObject({
      orderId: ORDER,
      canReview: true,
      hasPending: true,
      deliverer: { status: 'pending' },
    });
  });

  it('valorar al mensajero → 201 con el nuevo estado; repetirlo → 409 REVIEW_ALREADY_SUBMITTED', async () => {
    const first = await call('POST', `/api/v1/customers/me/orders/${ORDER}/reviews/deliverer`, {
      token: myToken(),
      body: { rating: 4.7 },
    });
    expect(first.status).toBe(201);
    expect(first.json?.data.deliverer).toMatchObject({ status: 'submitted', rating: 4.7 });

    const again = await call('POST', `/api/v1/customers/me/orders/${ORDER}/reviews/deliverer`, {
      token: myToken(),
      body: { rating: 1 },
    });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ code: 'REVIEW_ALREADY_SUBMITTED' });
  });

  it('el cliente nunca elige al mensajero: un delivererId en el body se ignora', async () => {
    await call('POST', `/api/v1/customers/me/orders/${ORDER}/reviews/deliverer`, {
      token: myToken(),
      body: { rating: 5, delivererId: 'cotherdeliverer000000000' },
    });
    expect(fakeReviewsHolder.current.state.delivererReviews[0]?.delivererId).toBe(DELIVERER);
  });

  it.each([0.9, 5.1, 4.75, 0, -3, '4.5'])('rating %s → 400 VALIDATION_ERROR', async (rating) => {
    const result = await call('POST', `/api/v1/customers/me/orders/${ORDER}/reviews/deliverer`, {
      token: myToken(),
      body: { rating },
    });
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fakeReviewsHolder.current.state.delivererReviews).toHaveLength(0);
  });

  it('valorar varios negocios de un pedido multi-negocio en un solo envío', async () => {
    const result = await call('POST', `/api/v1/customers/me/orders/${ORDER}/reviews/businesses`, {
      token: myToken(),
      body: {
        reviews: [
          { businessId: BIZ_A, rating: 5 },
          { businessId: BIZ_B, rating: 3.2 },
        ],
      },
    });
    expect(result.status).toBe(201);
    expect(result.json?.data.businesses.map((b: { rating: number }) => b.rating)).toEqual([5, 3.2]);
  });

  it('un negocio que no está en el pedido → 400 BUSINESS_NOT_IN_ORDER', async () => {
    const result = await call('POST', `/api/v1/customers/me/orders/${ORDER}/reviews/businesses`, {
      token: myToken(),
      body: { reviews: [{ businessId: 'cbusiness0000000000000x', rating: 5 }] },
    });
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ code: 'BUSINESS_NOT_IN_ORDER' });
  });

  it('pedido no completado → 409 ORDER_NOT_COMPLETED', async () => {
    const result = await call(
      'POST',
      `/api/v1/customers/me/orders/${ACTIVE_ORDER}/reviews/deliverer`,
      { token: myToken(), body: { rating: 5 } },
    );
    expect(result.status).toBe(409);
    expect(result.json).toMatchObject({ code: 'ORDER_NOT_COMPLETED' });
  });

  it('pedido ajeno: por /me → 404; poniendo el id del otro cliente en la URL → 403 (IDOR)', async () => {
    const viaMe = await call(
      'POST',
      `/api/v1/customers/me/orders/${OTHERS_ORDER}/reviews/deliverer`,
      {
        token: myToken(),
        body: { rating: 5 },
      },
    );
    expect(viaMe.status).toBe(404);

    const viaOtherId = await call(
      'POST',
      `/api/v1/customers/${OTHER}/orders/${OTHERS_ORDER}/reviews/deliverer`,
      { token: myToken(), body: { rating: 5 } },
    );
    expect(viaOtherId.status).toBe(403);
    expect(fakeReviewsHolder.current.state.delivererReviews).toHaveLength(0);
  });

  it('sin sesión → 401', async () => {
    const result = await call('GET', `/api/v1/customers/me/orders/${ORDER}/reviews`);
    expect(result.status).toBe(401);
  });

  it('GET /customers/me/reviews/pending lista solo lo pendiente propio', async () => {
    const result = await call('GET', '/api/v1/customers/me/reviews/pending', { token: myToken() });
    expect(result.status).toBe(200);
    expect(result.json?.data.map((p: { orderId: string }) => p.orderId)).toEqual([ORDER]);
  });
});

describe('reseñas de invitado (/guest/orders con X-Guest-Token)', () => {
  it('con el token del pedido puede ver el estado y valorar', async () => {
    const state = await call('GET', `/api/v1/guest/orders/${GUEST_ORDER}/reviews`, {
      guestToken: GUEST_TOKEN,
    });
    expect(state.status).toBe(200);
    expect(state.json?.data.hasPending).toBe(true);

    const created = await call('POST', `/api/v1/guest/orders/${GUEST_ORDER}/reviews/deliverer`, {
      guestToken: GUEST_TOKEN,
      body: { rating: 4.4 },
    });
    expect(created.status).toBe(201);
    expect(fakeReviewsHolder.current.state.delivererReviews[0]).toMatchObject({
      customerId: null,
      rating: 4.4,
    });
  });

  it('sin token → 401; token inválido → 404; el token de invitado no abre un pedido de cuenta', async () => {
    expect((await call('GET', `/api/v1/guest/orders/${GUEST_ORDER}/reviews`)).status).toBe(401);
    expect(
      (
        await call('GET', `/api/v1/guest/orders/${GUEST_ORDER}/reviews`, {
          guestToken: 'b'.repeat(64),
        })
      ).status,
    ).toBe(404);
    expect(
      (await call('GET', `/api/v1/guest/orders/${ORDER}/reviews`, { guestToken: GUEST_TOKEN }))
        .status,
    ).toBe(404);
  });

  it('un invitado no puede valorar dos veces', async () => {
    const path = `/api/v1/guest/orders/${GUEST_ORDER}/reviews/businesses`;
    const body = { reviews: [{ businessId: BIZ_A, rating: 5 }] };
    expect((await call('POST', path, { guestToken: GUEST_TOKEN, body })).status).toBe(201);
    expect((await call('POST', path, { guestToken: GUEST_TOKEN, body })).status).toBe(409);
  });
});

// Pruebas HTTP del checkout SIN cuenta (invitado) y con cuenta, y del seguimiento por token de
// invitado. Los repositorios/servicios de orders y catálogo están simulados: no requieren BD.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env';
import { errorHandler } from '../../middlewares/errorHandler';
import { NotFoundError } from '../../shared/errors';
import { Prisma } from '../../generated/prisma/client';
import { hashToken } from '../auth/token.service';
import { signCustomerAccessToken } from '../customer-auth/customer-token.service';
import { guestOrdersRouter } from '../guest-orders/guest-orders.routes';
import { checkoutRouter } from './checkout.routes';

vi.mock('../../middlewares/apiKeyAuth', () => ({
  apiKeyAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

interface StoredOrder {
  id: string;
  orderNumber: number;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  addressReference: string | null;
  clientRequestId: string | undefined;
  guestAccessTokenHash: string | undefined;
  status: string;
}

const store = vi.hoisted(() => ({
  orders: [] as StoredOrder[],
  createCalls: 0,
}));

function toDTO(order: StoredOrder) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerAddress: order.customerAddress,
    addressReference: order.addressReference,
    status: order.status,
    assignedAt: null,
    completedAt: null,
    cancelledAt: null,
    delivererName: null,
    updatedAt: new Date(),
  };
}

vi.mock('../orders/orders.service', () => ({
  getOrderByClientRequestId: vi.fn(async (clientRequestId: string) => {
    const found = store.orders.find((o) => o.clientRequestId === clientRequestId);
    return found ? toDTO(found) : null;
  }),
  assertNoRecentPendingAppOrder: vi.fn(async () => undefined),
  createOrder: vi.fn(
    async (
      input: {
        customerId?: string;
        customerName: string;
        customerPhone: string;
        customerAddress: string;
        addressReference?: string;
        clientRequestId?: string;
      },
      _registeredBy: unknown,
      options: { guestAccessTokenHash?: string } = {},
    ) => {
      store.createCalls++;
      const order: StoredOrder = {
        id: `cord${String(store.orders.length + 1).padStart(10, '0')}`,
        orderNumber: store.orders.length + 1,
        customerId: input.customerId ?? null,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerAddress: input.customerAddress,
        addressReference: input.addressReference ?? null,
        clientRequestId: input.clientRequestId,
        guestAccessTokenHash: options.guestAccessTokenHash,
        status: 'PENDING',
      };
      store.orders.push(order);
      return toDTO(order);
    },
  ),
  getGuestAccessTokenHash: vi.fn(
    async (id: string) => store.orders.find((o) => o.id === id)?.guestAccessTokenHash ?? null,
  ),
  findOrderByGuestAccessTokenHash: vi.fn(async (hash: string) => {
    const found = store.orders.find((o) => o.guestAccessTokenHash === hash);
    return found ? toDTO(found) : null;
  }),
  getOrderById: vi.fn(async (id: string) => {
    const found = store.orders.find((o) => o.id === id);
    if (!found) throw new NotFoundError('Pedido no encontrado', 'ORDER_NOT_FOUND');
    return toDTO(found);
  }),
}));

vi.mock('../businesses/businesses.repository', () => ({
  findById: vi.fn(async (id: string) => ({
    id,
    name: 'Negocio Test',
    deliveryFeeBase: new Prisma.Decimal(250),
  })),
}));
vi.mock('../businesses/business-status.service', () => ({
  isBusinessOpen: vi.fn(async () => ({ open: true })),
}));
vi.mock('../businesses/products.repository', () => ({
  findByIdForBusiness: vi.fn(async (id: string) => ({
    id,
    name: 'Producto Test',
    price: new Prisma.Decimal(100),
    active: true,
    available: true,
  })),
}));
vi.mock('../businesses/product-offers.repository', () => ({
  findActiveForProduct: vi.fn(async () => null),
}));
vi.mock('../customers/customers.service', () => ({
  assertCustomerExists: vi.fn(async (id: string) => ({
    id,
    name: 'Ana Cuenta',
    phone: '+5355551234',
  })),
}));
vi.mock('../customers/customer-addresses.repository', () => ({
  findByIdForCustomer: vi.fn(async () => ({
    address: 'Dirección guardada 1',
    reference: 'Portón azul',
  })),
}));

const CUSTOMER_ID = 'ccustomer00000000000001';
const validBusinesses = [
  {
    businessId: 'clx0000000000000000000000',
    items: [{ productId: 'clx0000000000000000000001', quantity: 1, expectedPrice: 100 }],
  },
];
const guestBody = {
  customerName: 'Invitado Prueba',
  customerPhone: '+53 5 555 0000',
  address: 'Calle 10 #123',
  addressReference: 'Casa verde',
  businesses: validBusinesses,
};

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

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/checkout', checkoutRouter);
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
  store.orders.length = 0;
  store.createCalls = 0;
});

describe('POST /checkout como invitado (sin Authorization)', () => {
  it('crea el pedido SIN cuenta: customerId null, snapshots intactos y guestAccessToken', async () => {
    const result = await call('POST', '/api/v1/checkout', { body: guestBody });

    expect(result.status).toBe(201);
    const order = result.json?.data;
    expect(order.customerId).toBeNull();
    expect(order.customerName).toBe('Invitado Prueba');
    expect(order.customerPhone).toBe('+53 5 555 0000'); // tal cual lo escribió
    expect(order.customerAddress).toBe('Calle 10 #123');
    expect(order.addressReference).toBe('Casa verde');
    expect(order.guestAccessToken).toMatch(/^[0-9a-f]{64}$/);

    // En la BD solo queda el HASH del token, nunca el token.
    const stored = store.orders[0];
    expect(stored?.guestAccessTokenHash).toBe(hashToken(order.guestAccessToken));
    expect(stored?.guestAccessTokenHash).not.toBe(order.guestAccessToken);
  });

  it('un customerId enviado en el body se ignora: no se puede suplantar a otra cuenta', async () => {
    const result = await call('POST', '/api/v1/checkout', {
      body: { ...guestBody, customerId: CUSTOMER_ID },
    });
    expect(result.status).toBe(201);
    expect(result.json?.data.customerId).toBeNull();
    expect(store.orders[0]?.customerId).toBeNull();
  });

  it('un teléfono que coincide con el de una cuenta NO vincula el pedido a esa cuenta', async () => {
    // El teléfono de la cuenta simulada es +5355551234.
    const result = await call('POST', '/api/v1/checkout', {
      body: { ...guestBody, customerPhone: '+5355551234' },
    });
    expect(result.status).toBe(201);
    expect(result.json?.data.customerId).toBeNull();
  });

  it('sin nombre/teléfono → 400 GUEST_DATA_REQUIRED indicando qué falta', async () => {
    const result = await call('POST', '/api/v1/checkout', {
      body: { address: 'Calle 10 #123', businesses: validBusinesses },
    });
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ code: 'GUEST_DATA_REQUIRED' });
    expect(result.json?.details.missing).toEqual(['customerName', 'customerPhone']);
    expect(store.createCalls).toBe(0);
  });

  it('un invitado no puede usar addressId (no tiene direcciones guardadas)', async () => {
    const result = await call('POST', '/api/v1/checkout', {
      body: { ...guestBody, addressId: 'clx0000000000000000000009' },
    });
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ code: 'ADDRESS_ID_REQUIRES_LOGIN' });
  });

  it('el reintento idempotente (respuesta perdida) devuelve el MISMO pedido y el MISMO token', async () => {
    const body = { ...guestBody, clientRequestId: 'app_retry_abc12345' };
    const first = await call('POST', '/api/v1/checkout', { body });
    const retry = await call('POST', '/api/v1/checkout', { body });

    expect(store.createCalls).toBe(1);
    expect(retry.json?.data.id).toBe(first.json?.data.id);
    expect(retry.json?.data.guestAccessToken).toBe(first.json?.data.guestAccessToken);
  });

  it('el mismo clientRequestId usado por OTRA identidad no permite leer el pedido → 409', async () => {
    await call('POST', '/api/v1/checkout', {
      body: { ...guestBody, clientRequestId: 'app_shared_abc12345' },
    });

    const asCustomer = await call('POST', '/api/v1/checkout', {
      body: {
        address: 'Otra dirección',
        clientRequestId: 'app_shared_abc12345',
        businesses: validBusinesses,
      },
      token: signCustomerAccessToken(CUSTOMER_ID),
    });
    expect(asCustomer.status).toBe(409);
    expect(asCustomer.json).toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
  });
});

describe('POST /checkout con cuenta (Bearer de cliente)', () => {
  it('vincula el pedido a la cuenta del TOKEN, usa sus datos y no entrega guestAccessToken', async () => {
    const result = await call('POST', '/api/v1/checkout', {
      token: signCustomerAccessToken(CUSTOMER_ID),
      body: { address: 'Calle 20 #5', businesses: validBusinesses },
    });
    expect(result.status).toBe(201);
    expect(result.json?.data.customerId).toBe(CUSTOMER_ID);
    expect(result.json?.data.customerName).toBe('Ana Cuenta');
    expect(result.json?.data.customerPhone).toBe('+5355551234');
    expect(result.json?.data).not.toHaveProperty('guestAccessToken');
    expect(store.orders[0]?.guestAccessTokenHash).toBeUndefined();
  });

  it('con addressId resuelve la dirección guardada de ESA cuenta', async () => {
    const result = await call('POST', '/api/v1/checkout', {
      token: signCustomerAccessToken(CUSTOMER_ID),
      body: { addressId: 'clx0000000000000000000009', businesses: validBusinesses },
    });
    expect(result.status).toBe(201);
    expect(result.json?.data.customerAddress).toBe('Dirección guardada 1');
    expect(result.json?.data.addressReference).toBe('Portón azul');
  });

  it('un token vencido NO degrada a invitado en silencio: 401 TOKEN_EXPIRED', async () => {
    const expired = jwt.sign({ sub: CUSTOMER_ID, typ: 'customer' }, env.JWT_ACCESS_SECRET, {
      expiresIn: -10,
    });
    const result = await call('POST', '/api/v1/checkout', { token: expired, body: guestBody });
    expect(result.status).toBe(401);
    expect(result.json).toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(store.createCalls).toBe(0);
  });

  it('un token de staff no sirve como identidad de cliente → 401', async () => {
    const staff = jwt.sign({ sub: 'u1', role: 'ADMIN' }, env.JWT_ACCESS_SECRET);
    const result = await call('POST', '/api/v1/checkout', { token: staff, body: guestBody });
    expect(result.status).toBe(401);
  });
});

describe('seguimiento de un pedido de invitado (X-Guest-Token)', () => {
  async function guestOrder(clientRequestId: string) {
    const created = await call('POST', '/api/v1/checkout', {
      body: { ...guestBody, clientRequestId },
    });
    return {
      id: created.json?.data.id as string,
      token: created.json?.data.guestAccessToken as string,
    };
  }

  it('con el token correcto ve el estado (DTO liviano) y el pedido', async () => {
    const { id, token } = await guestOrder('app_guest_track_1');

    const status = await call('GET', `/api/v1/guest/orders/${id}/status`, { guestToken: token });
    expect(status.status).toBe(200);
    expect(Object.keys(status.json?.data).sort()).toEqual(
      [
        'assignedAt',
        'cancelledAt',
        'completedAt',
        'delivererName',
        'orderNumber',
        'status',
        'updatedAt',
      ].sort(),
    );

    const detail = await call('GET', `/api/v1/guest/orders/${id}`, { guestToken: token });
    expect(detail.status).toBe(200);
    expect(detail.json?.data.id).toBe(id);
  });

  it('sin token → 401; token inválido → 404 (no revela si el pedido existe)', async () => {
    const { id } = await guestOrder('app_guest_track_2');
    expect((await call('GET', `/api/v1/guest/orders/${id}/status`)).status).toBe(401);
    expect(
      (await call('GET', `/api/v1/guest/orders/${id}/status`, { guestToken: 'x'.repeat(64) }))
        .status,
    ).toBe(404);
  });

  it('el token de OTRO pedido de invitado no abre este (IDOR entre invitados)', async () => {
    const a = await guestOrder('app_guest_track_3');
    const b = await guestOrder('app_guest_track_4');
    const cross = await call('GET', `/api/v1/guest/orders/${a.id}/status`, {
      guestToken: b.token,
    });
    expect(cross.status).toBe(404);
  });

  it('un pedido de cuenta no es accesible por la vía de invitado', async () => {
    const created = await call('POST', '/api/v1/checkout', {
      token: signCustomerAccessToken(CUSTOMER_ID),
      body: { address: 'Calle 20 #5', businesses: validBusinesses },
    });
    const id = created.json?.data.id as string;
    const result = await call('GET', `/api/v1/guest/orders/${id}/status`, {
      guestToken: hashToken('cualquiera'),
    });
    expect(result.status).toBe(404);
  });

  it('conocer el id del pedido (o el teléfono) sin token no da acceso', async () => {
    const { id } = await guestOrder('app_guest_track_5');
    expect((await call('GET', `/api/v1/guest/orders/${id}`)).status).toBe(401);
  });
});

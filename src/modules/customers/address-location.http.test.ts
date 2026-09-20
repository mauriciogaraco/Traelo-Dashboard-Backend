// Pruebas HTTP de la ubicación OPCIONAL (pin): direcciones guardadas y checkout. Lo esencial:
// la dirección textual basta, las coordenadas nunca son requisito, y el pedido conserva su propio
// snapshot. Repositorios y servicios de pedidos simulados: no requieren base de datos.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../middlewares/errorHandler';
import { Prisma } from '../../generated/prisma/client';
import { signCustomerAccessToken } from '../customer-auth/customer-token.service';
import { customersRouter } from './customers.routes';
import { checkoutRouter } from '../checkout/checkout.routes';
import { resolveDestination } from './customer-orders.service';

vi.mock('../../middlewares/apiKeyAuth', () => ({
  apiKeyAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const db = vi.hoisted(() => ({
  addresses: new Map<string, Record<string, unknown>>(),
  createOrderCalls: [] as { input: Record<string, unknown>; options: Record<string, unknown> }[],
  nextId: 1,
}));

vi.mock('./customers.repository', () => ({
  findById: vi.fn(async (id: string) => ({
    id,
    name: 'Ana',
    phone: '+5355551234',
    email: null,
    phoneVerified: false,
    emailVerified: false,
    pointsBalance: 0,
    lastOrderAt: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  touchLastOrderAt: vi.fn(),
}));

vi.mock('./customer-addresses.repository', () => ({
  findManyForCustomer: vi.fn(async (customerId: string) =>
    [...db.addresses.values()].filter((a) => a.customerId === customerId),
  ),
  findByIdForCustomer: vi.fn(async (id: string, customerId: string) => {
    const row = db.addresses.get(id);
    return row && row.customerId === customerId ? row : null;
  }),
  create: vi.fn(async (customerId: string, data: Record<string, unknown>) => {
    const id = `caddress${String(db.nextId++).padStart(16, '0')}`;
    const row = {
      id,
      customerId,
      reference: null,
      latitude: null,
      longitude: null,
      locationSource: null,
      locationAccuracy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };
    db.addresses.set(id, row);
    return row;
  }),
  update: vi.fn(async (_customerId: string, id: string, data: Record<string, unknown>) => {
    const row = { ...db.addresses.get(id), ...data, updatedAt: new Date() };
    db.addresses.set(id, row);
    return row;
  }),
  deleteById: vi.fn(async (id: string) => void db.addresses.delete(id)),
}));

vi.mock('../orders/orders.service', () => ({
  getOrderByClientRequestId: vi.fn(async () => null),
  assertNoRecentPendingAppOrder: vi.fn(async () => undefined),
  getGuestAccessTokenHash: vi.fn(async () => null),
  createOrder: vi.fn(
    async (input: Record<string, unknown>, _userId: unknown, options: Record<string, unknown>) => {
      db.createOrderCalls.push({ input, options });
      return {
        id: 'corder00000000000000001',
        orderNumber: 1,
        customerId: input.customerId ?? null,
      };
    },
  ),
}));

vi.mock('../businesses/businesses.repository', () => ({
  findById: vi.fn(async (id: string) => ({
    id,
    name: 'Pizzería',
    deliveryFeeBase: new Prisma.Decimal(250),
  })),
}));
vi.mock('../businesses/business-status.service', () => ({
  isBusinessOpen: vi.fn(async () => ({ open: true })),
}));
vi.mock('../businesses/products.repository', () => ({
  findByIdForBusiness: vi.fn(async (id: string) => ({
    id,
    name: 'Pizza',
    active: true,
    available: true,
    price: new Prisma.Decimal(500),
  })),
}));
vi.mock('../businesses/product-offers.repository', () => ({
  findActiveForProduct: vi.fn(async () => null),
}));

const ME = 'ccustomer00000000000001';
const BUSINESS = 'cbusiness0000000000000a';
const PRODUCT = 'cproduct00000000000000a';
const PIN = { latitude: 22.7958, longitude: -82.5065 };

let server: Server;
let baseUrl: string;

async function call(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
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

const token = () => signCustomerAccessToken(ME);
const createAddress = (body: Record<string, unknown>) =>
  call('POST', '/api/v1/customers/me/addresses', {
    body: { label: 'Casa', address: 'Calle 82 #4107 entre 41 y 43', ...body },
    token: token(),
  });
const patchAddress = (id: string, body: Record<string, unknown>) =>
  call('PATCH', `/api/v1/customers/me/addresses/${id}`, { body, token: token() });

const cart = {
  businesses: [{ businessId: BUSINESS, items: [{ productId: PRODUCT, quantity: 1 }] }],
};
const guestCheckout = (extra: Record<string, unknown> = {}) =>
  call('POST', '/api/v1/checkout', {
    body: {
      customerName: 'Ana Pérez',
      customerPhone: '+5355551234',
      address: 'Calle 82 #4107 entre 41 y 43',
      addressReference: 'Casa azul frente al parque',
      ...cart,
      ...extra,
    },
  });
const accountCheckout = (extra: Record<string, unknown>) =>
  call('POST', '/api/v1/checkout', { body: { ...cart, ...extra }, token: token() });

const lastCreateOrder = () =>
  db.createOrderCalls[db.createOrderCalls.length - 1] as (typeof db.createOrderCalls)[number];

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/customers', customersRouter);
  app.use('/api/v1/checkout', checkoutRouter);
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
  db.addresses.clear();
  db.createOrderCalls.length = 0;
  db.nextId = 1;
});

describe('direcciones guardadas — la ubicación es OPCIONAL', () => {
  it('se guarda igual sin ubicación: location null, sin pedir coordenadas', async () => {
    const { status, json } = await createAddress({});
    expect(status).toBe(201);
    expect(json?.data.location).toBeNull();
  });

  it('con pin manual: se guarda y se devuelve agrupada en location', async () => {
    const { status, json } = await createAddress({ location: { ...PIN, source: 'MANUAL_PIN' } });
    expect(status).toBe(201);
    expect(json?.data.location).toEqual({ ...PIN, accuracy: null, source: 'MANUAL_PIN' });
  });

  it('el pin es MANUAL_PIN por defecto y un pin manual no guarda "precisión"', async () => {
    const { json } = await createAddress({ location: { ...PIN, accuracy: 12 } });
    expect(json?.data.location).toMatchObject({ source: 'MANUAL_PIN', accuracy: null });
  });

  it('si vino del GPS del dispositivo conserva la precisión', async () => {
    const { json } = await createAddress({
      location: { ...PIN, source: 'DEVICE_LOCATION', accuracy: 12 },
    });
    expect(json?.data.location).toMatchObject({ source: 'DEVICE_LOCATION', accuracy: 12 });
  });

  it('el listado también devuelve la ubicación (o null)', async () => {
    await createAddress({ label: 'Con pin', location: PIN });
    await createAddress({ label: 'Sin pin' });
    const { json } = await call('GET', '/api/v1/customers/me/addresses', { token: token() });
    const byLabel = Object.fromEntries(
      (json?.data as { label: string; location: unknown }[]).map((a) => [a.label, a.location]),
    );
    expect(byLabel['Con pin']).toMatchObject(PIN);
    expect(byLabel['Sin pin']).toBeNull();
  });

  it.each([
    ['latitud fuera de rango', { latitude: 91, longitude: 0 }],
    ['longitud fuera de rango', { latitude: 0, longitude: -181 }],
    ['solo latitud', { latitude: 22.79 }],
    ['solo longitud', { longitude: -82.5 }],
    ['precisión negativa', { ...PIN, source: 'DEVICE_LOCATION', accuracy: -5 }],
    ['coordenadas como texto', { latitude: '22.79', longitude: '-82.5' }],
    ['origen desconocido', { ...PIN, source: 'ADIVINADO' }],
  ])('rechaza una ubicación inválida (%s)', async (_label, location) => {
    const { status, json } = await createAddress({ location });
    expect(status).toBe(400);
    expect(json?.code).toBe('VALIDATION_ERROR');
    expect(db.addresses.size).toBe(0);
  });

  it('PATCH: fija, conserva y quita la ubicación', async () => {
    const created = (await createAddress({})).json?.data.id as string;

    const set = await patchAddress(created, { location: PIN });
    expect(set.json?.data.location).toMatchObject(PIN);

    const untouched = await patchAddress(created, { label: 'Casa de mamá' });
    expect(untouched.json?.data).toMatchObject({ label: 'Casa de mamá', location: { ...PIN } });

    const cleared = await patchAddress(created, { location: null });
    expect(cleared.json?.data.location).toBeNull();
    expect(db.addresses.get(created)).toMatchObject({
      latitude: null,
      longitude: null,
      locationSource: null,
      locationAccuracy: null,
    });
  });

  it('no se puede tocar la dirección de otro cliente', async () => {
    const { status } = await call(
      'PATCH',
      '/api/v1/customers/ccustomer00000000000002/addresses/caddress0000000000000001',
      {
        body: { location: PIN },
        token: token(),
      },
    );
    expect(status).toBe(403);
  });
});

describe('checkout — el pin nunca es requisito', () => {
  it('invitado SIN ubicación: el pedido se crea normalmente (destination null)', async () => {
    const { status } = await guestCheckout();
    expect(status).toBe(201);
    expect(lastCreateOrder().options.destination).toBeNull();
    expect(lastCreateOrder().input).toMatchObject({
      customerAddress: 'Calle 82 #4107 entre 41 y 43',
      addressReference: 'Casa azul frente al parque',
    });
  });

  it('invitado CON pin: se copia al pedido', async () => {
    const { status } = await guestCheckout({ location: { ...PIN, source: 'MANUAL_PIN' } });
    expect(status).toBe(201);
    expect(lastCreateOrder().options.destination).toEqual(PIN);
  });

  it('location null se acepta (sin pin explícito)', async () => {
    expect((await guestCheckout({ location: null })).status).toBe(201);
    expect(lastCreateOrder().options.destination).toBeNull();
  });

  it('con addressId: el pedido copia el pin de la dirección guardada', async () => {
    const id = (await createAddress({ location: PIN })).json?.data.id as string;
    const { status } = await accountCheckout({ addressId: id });

    expect(status).toBe(201);
    expect(lastCreateOrder().options.destination).toEqual(PIN);
  });

  it('con addressId SIN pin: se crea igual, sin ubicación', async () => {
    const id = (await createAddress({})).json?.data.id as string;
    expect((await accountCheckout({ addressId: id })).status).toBe(201);
    expect(lastCreateOrder().options.destination).toBeNull();
  });

  it('un pin enviado para este pedido gana sobre el de la dirección guardada', async () => {
    const id = (await createAddress({ location: PIN })).json?.data.id as string;
    const other = { latitude: 22.8, longitude: -82.4 };
    await accountCheckout({ addressId: id, location: other });
    expect(lastCreateOrder().options.destination).toEqual(other);
  });

  it('location: null con addressId = "sin ubicación en este pedido", aunque la dirección tenga pin', async () => {
    const id = (await createAddress({ location: PIN })).json?.data.id as string;
    await accountCheckout({ addressId: id, location: null });
    expect(lastCreateOrder().options.destination).toBeNull();
  });

  it('coordenadas inválidas en el checkout: 400 y no se crea ningún pedido', async () => {
    const { status, json } = await guestCheckout({ location: { latitude: 200, longitude: 0 } });
    expect(status).toBe(400);
    expect(json?.code).toBe('VALIDATION_ERROR');
    expect(db.createOrderCalls).toHaveLength(0);
  });

  it('el pedido conserva SU ubicación aunque la dirección guardada cambie después (snapshot)', async () => {
    const id = (await createAddress({ location: PIN })).json?.data.id as string;
    await accountCheckout({ addressId: id });
    const snapshot = lastCreateOrder().options.destination;

    await patchAddress(id, { location: { latitude: 23.1, longitude: -82.3 } });
    await patchAddress(id, { location: null });

    expect(snapshot).toEqual(PIN); // lo que se le pasó al pedido es una copia, no una referencia viva
    expect(db.createOrderCalls).toHaveLength(1); // editar la dirección nunca recrea ni modifica pedidos
  });
});

describe('resolveDestination', () => {
  const saved = { latitude: 22.79, longitude: -82.5 };

  it('undefined usa la dirección guardada; sin ella, nada', () => {
    expect(resolveDestination(undefined, saved)).toEqual(saved);
    expect(resolveDestination(undefined, null)).toBeNull();
    expect(resolveDestination(undefined, { latitude: null, longitude: null })).toBeNull();
  });

  it('null anula; un objeto gana', () => {
    expect(resolveDestination(null, saved)).toBeNull();
    expect(resolveDestination({ latitude: 1, longitude: 2 }, saved)).toEqual({
      latitude: 1,
      longitude: 2,
    });
  });

  it('una dirección con coordenadas a medias cuenta como sin ubicación', () => {
    expect(resolveDestination(undefined, { latitude: 22.79, longitude: null })).toBeNull();
  });
});

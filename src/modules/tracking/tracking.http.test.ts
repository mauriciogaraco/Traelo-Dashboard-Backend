// Pruebas HTTP del seguimiento en vivo: consulta del cliente (cuenta e invitado), autorización/IDOR,
// reglas por estado del pedido y la ruta de la ubicación del mensajero. Los repositorios están
// simulados (en memoria): no requieren base de datos.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env';
import { errorHandler } from '../../middlewares/errorHandler';
import { Prisma } from '../../generated/prisma/client';
import { signCustomerAccessToken } from '../customer-auth/customer-token.service';
import { hashGuestAccessToken } from '../guest-orders/guest-token';
import { customersRouter } from '../customers/customers.routes';
import { guestOrdersRouter } from '../guest-orders/guest-orders.routes';
import { deliverersRouter } from '../deliverers/deliverers.routes';
import { releaseLocationIfIdleSafely } from './deliverer-location.service';
import { LOCATION_MAX_AGE_MS } from './tracking.constants';
import { resetRouteCache, setRouteProvider } from '../routing/routing.service';

vi.mock('../../middlewares/apiKeyAuth', () => ({
  apiKeyAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

type Row = Record<string, unknown>;

// Estado en memoria compartido por los repositorios simulados (vi.mock se iza: hay que hoistear).
const db = vi.hoisted(() => ({
  orders: new Map<string, Record<string, unknown>>(),
  customers: new Set<string>(),
  deliverers: new Map<string, { id: string; userId: string; active: boolean }>(),
  locations: new Map<
    string,
    {
      delivererId: string;
      latitude: number;
      longitude: number;
      accuracy: number | null;
      updatedAt: Date;
    }
  >(),
  upserts: 0,
}));

vi.mock('../orders/orders.repository', () => ({
  findById: vi.fn(async (id: string) => db.orders.get(id) ?? null),
  findByGuestAccessTokenHash: vi.fn(
    async (hash: string) =>
      [...db.orders.values()].find((o) => o.guestAccessTokenHash === hash) ?? null,
  ),
}));

vi.mock('../customers/customers.repository', () => ({
  findById: vi.fn(async (id: string) =>
    db.customers.has(id)
      ? {
          id,
          name: 'Cliente',
          phone: '+5355550000',
          email: null,
          phoneVerified: false,
          emailVerified: false,
          pointsBalance: 0,
          lastOrderAt: null,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : null,
  ),
}));

vi.mock('../deliverers/deliverers.repository', () => ({
  findByUserId: vi.fn(async (userId: string) => {
    const deliverer = [...db.deliverers.values()].find((d) => d.userId === userId);
    return deliverer
      ? {
          id: deliverer.id,
          userId,
          user: { name: 'Saúl', email: 's@t.cu', phone: '+5355559999', active: deliverer.active },
        }
      : null;
  }),
}));

vi.mock('./deliverer-location.repository', () => ({
  findByDelivererId: vi.fn(async (delivererId: string) => db.locations.get(delivererId) ?? null),
  upsert: vi.fn(
    async (
      delivererId: string,
      data: { latitude: number; longitude: number; accuracy: number | null; updatedAt: Date },
    ) => {
      db.upserts += 1;
      const row = { delivererId, ...data };
      db.locations.set(delivererId, row);
      return row;
    },
  ),
  deleteByDelivererId: vi.fn(async (delivererId: string) => void db.locations.delete(delivererId)),
  countActiveDeliveries: vi.fn(
    async (delivererId: string) =>
      [...db.orders.values()].filter(
        (o) => o.delivererId === delivererId && o.status === 'ASSIGNED',
      ).length,
  ),
}));

const ME = 'ccustomer00000000000001';
const OTHER = 'ccustomer00000000000002';
const DELIVERER = 'cdeliverer0000000000001';
const DELIVERER_USER = 'cuser0000000000000000001';
const OTHER_DELIVERER = 'cdeliverer0000000000002';
const OTHER_DELIVERER_USER = 'cuser0000000000000000002';
const ORDER_ASSIGNED = 'corder00000000000000001';
const ORDER_PENDING = 'corder00000000000000002';
const ORDER_COMPLETED = 'corder00000000000000003';
const ORDER_CANCELLED = 'corder00000000000000004';
const ORDER_OTHERS = 'corder00000000000000005';
const ORDER_GUEST = 'corder00000000000000006';
const GUEST_TOKEN = 'a'.repeat(64);

function makeOrder(overrides: Row): Row {
  const now = new Date();
  return {
    id: ORDER_ASSIGNED,
    orderNumber: 1234,
    customerName: 'Cliente',
    customerAddress: 'Calle 23 entre 10 y 12',
    addressReference: 'Casa azul con reja',
    destinationLatitude: null,
    destinationLongitude: null,
    customerPhone: '+5355550000',
    deliveryFee: new Prisma.Decimal(250),
    status: 'ASSIGNED',
    source: 'APP',
    orderDate: now,
    assignedAt: now,
    pickingUpAt: now,
    onTheWayAt: null,
    completedAt: null,
    cancelledAt: null,
    customerId: ME,
    guestAccessTokenHash: null,
    delivererId: DELIVERER,
    deliverer: { id: DELIVERER, photoUrl: null, user: { id: DELIVERER_USER, name: 'Saúl', phone: '+5355559999' } },
    registeredByUserId: null,
    registeredBy: null,
    raffleNumber: null,
    productsTotal: new Prisma.Decimal(1000),
    platformFee: new Prisma.Decimal(100),
    pointsDiscount: new Prisma.Decimal(0),
    redemption: null,
    total: new Prisma.Decimal(1350),
    traeloEarning: new Prisma.Decimal(0),
    traeloDeliveryShare: new Prisma.Decimal(0),
    delivererEarning: new Prisma.Decimal(0),
    businesses: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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

const customerToken = () => signCustomerAccessToken(ME);
const staffToken = (sub: string, role: string) => jwt.sign({ sub, role }, env.JWT_ACCESS_SECRET);
const trackingOf = (orderId: string, token = customerToken()) =>
  call('GET', `/api/v1/customers/me/orders/${orderId}/tracking`, { token });
const sendLocation = (body: unknown, token = staffToken(DELIVERER_USER, 'DELIVERER')) =>
  call('POST', '/api/v1/deliverers/me/location', { body, token });

function seedLocation(delivererId = DELIVERER, ageMs = 5_000) {
  db.locations.set(delivererId, {
    delivererId,
    latitude: 22.7958,
    longitude: -82.5065,
    accuracy: 12,
    updatedAt: new Date(Date.now() - ageMs),
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/customers', customersRouter);
  app.use('/api/v1/guest/orders', guestOrdersRouter);
  app.use('/api/v1/deliverers', deliverersRouter);
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
  db.orders.clear();
  db.locations.clear();
  db.customers = new Set([ME, OTHER]);
  db.deliverers.clear();
  db.deliverers.set(DELIVERER, { id: DELIVERER, userId: DELIVERER_USER, active: true });
  db.deliverers.set(OTHER_DELIVERER, {
    id: OTHER_DELIVERER,
    userId: OTHER_DELIVERER_USER,
    active: true,
  });
  db.upserts = 0;

  db.orders.set(ORDER_ASSIGNED, makeOrder({ id: ORDER_ASSIGNED }));
  db.orders.set(
    ORDER_PENDING,
    makeOrder({
      id: ORDER_PENDING,
      status: 'PENDING',
      delivererId: null,
      deliverer: null,
      assignedAt: null,
      pickingUpAt: null,
    }),
  );
  db.orders.set(
    ORDER_COMPLETED,
    makeOrder({ id: ORDER_COMPLETED, status: 'COMPLETED', completedAt: new Date() }),
  );
  db.orders.set(
    ORDER_CANCELLED,
    makeOrder({ id: ORDER_CANCELLED, status: 'CANCELLED', cancelledAt: new Date() }),
  );
  db.orders.set(ORDER_OTHERS, makeOrder({ id: ORDER_OTHERS, customerId: OTHER }));
  db.orders.set(
    ORDER_GUEST,
    makeOrder({
      id: ORDER_GUEST,
      customerId: null,
      guestAccessTokenHash: hashGuestAccessToken(GUEST_TOKEN),
    }),
  );
});

describe('GET /customers/me/orders/:orderId/tracking', () => {
  it('cliente autorizado: estado, mensajero, ubicación y destino snapshot del pedido', async () => {
    seedLocation();
    const { status, json } = await trackingOf(ORDER_ASSIGNED);

    expect(status).toBe(200);
    expect(json?.data).toMatchObject({
      orderId: ORDER_ASSIGNED,
      orderNumber: 1234,
      status: 'ASSIGNED',
      trackingActive: true,
      deliverer: { name: 'Saúl' },
      location: { latitude: 22.7958, longitude: -82.5065, accuracy: 12 },
      destination: {
        address: 'Calle 23 entre 10 y 12',
        reference: 'Casa azul con reja',
        latitude: null,
        longitude: null,
      },
    });
    expect(typeof json?.data.serverTime).toBe('string');
    expect(typeof json?.data.location.updatedAt).toBe('string');
  });

  it('CONFIRMADO (mensajero asignado, todavía no va por el pedido): sin seguimiento, ubicación ni ruta', async () => {
    seedLocation();
    db.orders.set(
      ORDER_ASSIGNED,
      makeOrder({ id: ORDER_ASSIGNED, pickingUpAt: null, destinationLatitude: 22.79, destinationLongitude: -82.51 }),
    );
    const { status, json } = await trackingOf(ORDER_ASSIGNED);

    expect(status).toBe(200);
    expect(json?.data).toMatchObject({
      status: 'ASSIGNED',
      trackingActive: false,
      pickingUpAt: null,
      onTheWayAt: null,
      deliverer: null,
      location: null,
      route: null,
    });
  });

  it('la foto de perfil del mensajero viaja junto a su nombre (null si no tiene)', async () => {
    seedLocation();
    const without = await trackingOf(ORDER_ASSIGNED);
    expect(without.json?.data.deliverer).toEqual({ name: 'Saúl', photoUrl: null });

    db.orders.set(
      ORDER_ASSIGNED,
      makeOrder({
        id: ORDER_ASSIGNED,
        deliverer: {
          id: DELIVERER,
          photoUrl: 'https://res.cloudinary.com/demo/saul.jpg',
          user: { id: DELIVERER_USER, name: 'Saúl', phone: '+5355559999' },
        },
      }),
    );
    const withPhoto = await trackingOf(ORDER_ASSIGNED);
    expect(withPhoto.json?.data.deliverer).toEqual({ name: 'Saúl', photoUrl: 'https://res.cloudinary.com/demo/saul.jpg' });
  });

  it('RECOGIENDO: el seguimiento se activa y trae la hora de la etapa', async () => {
    seedLocation();
    const { json } = await trackingOf(ORDER_ASSIGNED);
    expect(json?.data.trackingActive).toBe(true);
    expect(typeof json?.data.pickingUpAt).toBe('string');
    expect(json?.data.onTheWayAt).toBeNull();
  });

  it('EN CAMINO: sigue activo y trae ambas horas', async () => {
    seedLocation();
    db.orders.set(ORDER_ASSIGNED, makeOrder({ id: ORDER_ASSIGNED, onTheWayAt: new Date() }));
    const { json } = await trackingOf(ORDER_ASSIGNED);
    expect(json?.data.trackingActive).toBe(true);
    expect(typeof json?.data.onTheWayAt).toBe('string');
  });

  it('la respuesta no expone datos innecesarios (id/teléfono del mensajero, finanzas, otros pedidos)', async () => {
    seedLocation();
    const { json } = await trackingOf(ORDER_ASSIGNED);
    const raw = JSON.stringify(json?.data);

    expect(Object.keys(json?.data.deliverer)).toEqual(['name', 'photoUrl']);
    expect(raw).not.toContain(DELIVERER);
    expect(raw).not.toContain(DELIVERER_USER);
    expect(raw).not.toContain('5355559999');
    expect(raw).not.toContain('delivererEarning');
    expect(raw).not.toContain('customerPhone');
    expect(raw).not.toContain('businesses');
  });

  it('el destino sale de las columnas snapshot del pedido, con sus coordenadas si existen', async () => {
    seedLocation();
    db.orders.set(
      ORDER_ASSIGNED,
      makeOrder({ id: ORDER_ASSIGNED, destinationLatitude: 22.79, destinationLongitude: -82.51 }),
    );
    const { json } = await trackingOf(ORDER_ASSIGNED);
    expect(json?.data.destination).toMatchObject({ latitude: 22.79, longitude: -82.51 });
  });

  it('cliente NO puede consultar el pedido de otro cliente (IDOR) y no se filtra la ubicación', async () => {
    seedLocation();
    const { status, json } = await trackingOf(ORDER_OTHERS);

    expect(status).toBe(403);
    expect(JSON.stringify(json)).not.toContain('22.7958');
    expect(json?.data).toBeUndefined();
  });

  it('un pedido de invitado tampoco es accesible con una cuenta', async () => {
    const { status } = await trackingOf(ORDER_GUEST);
    expect(status).toBe(403);
  });

  it('requiere sesión: sin Bearer responde 401', async () => {
    const { status } = await call('GET', `/api/v1/customers/me/orders/${ORDER_ASSIGNED}/tracking`);
    expect(status).toBe(401);
  });

  it('un id de pedido inexistente o mal formado responde 404/400', async () => {
    expect((await trackingOf('corder00000000000000099')).status).toBe(404);
    expect((await trackingOf('no-es-un-cuid')).status).toBe(400);
  });

  it('pedido sin mensajero (PENDING): tracking sin ubicación ni mensajero', async () => {
    // Aunque hubiese una posición guardada de otro mensajero, un pedido sin mensajero no la recibe.
    seedLocation();
    const { status, json } = await trackingOf(ORDER_PENDING);

    expect(status).toBe(200);
    expect(json?.data).toMatchObject({
      status: 'PENDING',
      trackingActive: false,
      deliverer: null,
      location: null,
    });
  });

  it('pedido asignado pero sin ubicación guardada todavía: location null (no es un error)', async () => {
    const { status, json } = await trackingOf(ORDER_ASSIGNED);
    expect(status).toBe(200);
    expect(json?.data).toMatchObject({
      trackingActive: true,
      deliverer: { name: 'Saúl' },
      location: null,
    });
  });

  it('pedido COMPLETED: el seguimiento terminó y no se expone ubicación', async () => {
    seedLocation();
    const { status, json } = await trackingOf(ORDER_COMPLETED);

    expect(status).toBe(200);
    expect(json?.data).toMatchObject({
      status: 'COMPLETED',
      trackingActive: false,
      deliverer: null,
      location: null,
    });
  });

  it('pedido CANCELLED: el seguimiento terminó y no se expone ubicación', async () => {
    seedLocation();
    const { status, json } = await trackingOf(ORDER_CANCELLED);

    expect(status).toBe(200);
    expect(json?.data).toMatchObject({
      status: 'CANCELLED',
      trackingActive: false,
      deliverer: null,
      location: null,
    });
  });

  it('una ubicación más vieja que el tope de privacidad no se entrega', async () => {
    seedLocation(DELIVERER, LOCATION_MAX_AGE_MS + 60_000);
    const { json } = await trackingOf(ORDER_ASSIGNED);
    expect(json?.data.location).toBeNull();
  });

  it('solo ve la ubicación de SU mensajero, no la de otro', async () => {
    seedLocation(OTHER_DELIVERER);
    const { json } = await trackingOf(ORDER_ASSIGNED);
    expect(json?.data.location).toBeNull();
  });
});

describe('GET /guest/orders/:orderId/tracking', () => {
  it('con el token del pedido: devuelve el seguimiento', async () => {
    seedLocation();
    const { status, json } = await call('GET', `/api/v1/guest/orders/${ORDER_GUEST}/tracking`, {
      guestToken: GUEST_TOKEN,
    });

    expect(status).toBe(200);
    expect(json?.data).toMatchObject({
      orderId: ORDER_GUEST,
      trackingActive: true,
      location: { latitude: 22.7958 },
    });
  });

  it('sin token: 401. Con token de otro pedido o inválido: 404 (no revela si existe)', async () => {
    expect((await call('GET', `/api/v1/guest/orders/${ORDER_GUEST}/tracking`)).status).toBe(401);
    expect(
      (
        await call('GET', `/api/v1/guest/orders/${ORDER_GUEST}/tracking`, {
          guestToken: 'b'.repeat(64),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('GET', `/api/v1/guest/orders/${ORDER_ASSIGNED}/tracking`, {
          guestToken: GUEST_TOKEN,
        })
      ).status,
    ).toBe(404);
  });
});

describe('POST /deliverers/me/location', () => {
  beforeEach(() => {
    // El mensajero necesita una entrega activa para que se guarde su posición.
    db.orders.set(ORDER_ASSIGNED, makeOrder({ id: ORDER_ASSIGNED }));
  });

  it('mensajero autenticado actualiza su propia ubicación (updatedAt lo pone el servidor)', async () => {
    const before = Date.now();
    const { status, json } = await sendLocation({
      latitude: 22.7958,
      longitude: -82.5065,
      accuracy: 12,
    });

    expect(status).toBe(200);
    expect(json?.data).toMatchObject({ latitude: 22.7958, longitude: -82.5065, accuracy: 12 });
    const saved = db.locations.get(DELIVERER);
    expect(saved).toBeDefined();
    expect(saved?.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('ignora un delivererId (y un timestamp) enviados en el body: la identidad sale del token', async () => {
    const { status } = await sendLocation({
      delivererId: OTHER_DELIVERER,
      updatedAt: '2001-01-01T00:00:00.000Z',
      latitude: 22.8,
      longitude: -82.4,
    });

    expect(status).toBe(200);
    expect(db.locations.has(OTHER_DELIVERER)).toBe(false);
    expect(db.locations.get(DELIVERER)?.latitude).toBe(22.8);
    expect(db.locations.get(DELIVERER)?.updatedAt.getFullYear()).toBeGreaterThan(2001);
  });

  it('cada envío pisa la posición anterior: una sola fila por mensajero, sin histórico', async () => {
    await sendLocation({ latitude: 22.795, longitude: -82.507 });
    await sendLocation({ latitude: 22.7958, longitude: -82.5065, accuracy: 8 });

    expect(db.upserts).toBe(2);
    expect(db.locations.size).toBe(1);
    expect(db.locations.get(DELIVERER)).toMatchObject({
      latitude: 22.7958,
      longitude: -82.5065,
      accuracy: 8,
    });
  });

  it('accuracy es opcional y se guarda como null', async () => {
    await sendLocation({ latitude: 22.795, longitude: -82.507 });
    expect(db.locations.get(DELIVERER)?.accuracy).toBeNull();
  });

  it.each([
    ['latitud > 90', { latitude: 90.0001, longitude: 0 }],
    ['latitud < -90', { latitude: -91, longitude: 0 }],
    ['longitud > 180', { latitude: 0, longitude: 180.5 }],
    ['longitud < -180', { latitude: 0, longitude: -181 }],
    ['accuracy negativa', { latitude: 22, longitude: -82, accuracy: -1 }],
    ['latitud como texto', { latitude: '22.79', longitude: -82 }],
    ['sin longitud', { latitude: 22 }],
    ['body vacío', {}],
  ])('coordenadas inválidas rechazadas (%s)', async (_label, body) => {
    const { status, json } = await sendLocation(body);

    expect(status).toBe(400);
    expect(json?.code).toBe('VALIDATION_ERROR');
    expect(db.locations.size).toBe(0);
  });

  it('acepta los extremos válidos del rango', async () => {
    expect((await sendLocation({ latitude: 90, longitude: 180, accuracy: 0 })).status).toBe(200);
    expect((await sendLocation({ latitude: -90, longitude: -180 })).status).toBe(200);
  });

  it('un cliente (token de cliente) no puede actualizar la ubicación de un mensajero', async () => {
    const { status } = await sendLocation({ latitude: 22, longitude: -82 }, customerToken());
    expect(status).toBe(401);
    expect(db.locations.size).toBe(0);
  });

  it('personal que no es mensajero (EMPLOYEE/ADMIN) no puede: 403', async () => {
    for (const role of ['EMPLOYEE', 'ADMIN', 'OWNER', 'BUSINESS_OWNER']) {
      const { status } = await sendLocation(
        { latitude: 22, longitude: -82 },
        staffToken(DELIVERER_USER, role),
      );
      expect(status).toBe(403);
    }
    expect(db.locations.size).toBe(0);
  });

  it('sin token: 401', async () => {
    const { status } = await call('POST', '/api/v1/deliverers/me/location', {
      body: { latitude: 22, longitude: -82 },
    });
    expect(status).toBe(401);
  });

  it('sin entregas activas no se guarda nada y se borra la posición vieja (409 NO_ACTIVE_DELIVERY)', async () => {
    db.orders.clear(); // el mensajero ya no tiene pedidos ASSIGNED
    seedLocation();

    const { status, json } = await sendLocation({ latitude: 22.8, longitude: -82.4 });

    expect(status).toBe(409);
    expect(json?.code).toBe('NO_ACTIVE_DELIVERY');
    expect(db.upserts).toBe(0);
    expect(db.locations.size).toBe(0);
  });

  it('mensajero desactivado no puede enviar ubicación', async () => {
    db.deliverers.set(DELIVERER, { id: DELIVERER, userId: DELIVERER_USER, active: false });
    const { status } = await sendLocation({ latitude: 22, longitude: -82 });
    expect(status).toBe(403);
  });

  it('un usuario DELIVERER sin perfil de mensajero responde 404', async () => {
    const { status } = await sendLocation(
      { latitude: 22, longitude: -82 },
      staffToken('cuser0000000000000009999', 'DELIVERER'),
    );
    expect(status).toBe(404);
  });
});

describe('releaseLocationIfIdleSafely (limpieza al terminar un pedido)', () => {
  it('borra la posición cuando el mensajero ya no tiene entregas activas', async () => {
    db.orders.clear();
    seedLocation();
    await releaseLocationIfIdleSafely(DELIVERER);
    expect(db.locations.has(DELIVERER)).toBe(false);
  });

  it('conserva la posición si todavía tiene otra entrega activa', async () => {
    seedLocation(); // ORDER_ASSIGNED sigue ASSIGNED
    await releaseLocationIfIdleSafely(DELIVERER);
    expect(db.locations.has(DELIVERER)).toBe(true);
  });

  it('no hace nada sin mensajero (pedido nunca asignado)', async () => {
    seedLocation();
    await releaseLocationIfIdleSafely(null);
    expect(db.locations.has(DELIVERER)).toBe(true);
  });
});

describe('ruta del mensajero al destino en el tracking', () => {
  const ROUTE = {
    coordinates: [
      { latitude: 22.8066, longitude: -82.513 },
      { latitude: 22.7958, longitude: -82.5065 },
    ],
    distanceMeters: 1797,
    durationSeconds: 190,
  };
  const getRoute = vi.fn();
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const withPin = (overrides: Row = {}) =>
    db.orders.set(
      ORDER_ASSIGNED,
      makeOrder({
        id: ORDER_ASSIGNED,
        destinationLatitude: 22.7958,
        destinationLongitude: -82.5065,
        ...overrides,
      }),
    );

  beforeEach(() => {
    resetRouteCache();
    getRoute.mockReset();
    getRoute.mockResolvedValue(ROUTE);
    setRouteProvider({ getRoute });
  });

  afterEach(() => {
    setRouteProvider(null);
  });

  it('con pin de destino y mensajero visible: la 1.ª consulta responde sin esperar al motor y la siguiente trae la ruta', async () => {
    withPin();
    seedLocation();

    const first = await trackingOf(ORDER_ASSIGNED);
    expect(first.status).toBe(200);
    expect(first.json?.data.route).toBeNull();
    expect(getRoute).toHaveBeenCalledTimes(1);
    expect(getRoute).toHaveBeenCalledWith(
      { latitude: 22.7958, longitude: -82.5065 },
      { latitude: 22.7958, longitude: -82.5065 },
    );

    await settle();
    const second = await trackingOf(ORDER_ASSIGNED);
    expect(second.json?.data.route).toMatchObject({
      distanceMeters: 1797,
      coordinates: ROUTE.coordinates,
    });
    expect(typeof second.json?.data.route.computedAt).toBe('string');
    expect(getRoute).toHaveBeenCalledTimes(1); // la segunda salió de la caché
  });

  it('la ruta no incluye la duración (no hay ETA) ni datos internos', async () => {
    withPin();
    seedLocation();
    await trackingOf(ORDER_ASSIGNED);
    await settle();
    const { json } = await trackingOf(ORDER_ASSIGNED);

    expect(Object.keys(json?.data.route).sort()).toEqual([
      'computedAt',
      'coordinates',
      'distanceMeters',
    ]);
    expect(JSON.stringify(json)).not.toContain('durationSeconds');
  });

  it('sin pin de destino no hay ruta y ni siquiera se consulta al motor', async () => {
    seedLocation();
    await trackingOf(ORDER_ASSIGNED);
    await settle();
    const { json } = await trackingOf(ORDER_ASSIGNED);

    expect(json?.data.route).toBeNull();
    expect(getRoute).not.toHaveBeenCalled();
  });

  it('sin ubicación del mensajero no hay desde dónde trazar: sin ruta y sin consulta', async () => {
    withPin();
    const { json } = await trackingOf(ORDER_ASSIGNED);
    expect(json?.data.route).toBeNull();
    expect(getRoute).not.toHaveBeenCalled();
  });

  it('pedido entregado: sin ruta y sin consulta al motor', async () => {
    seedLocation();
    db.orders.set(
      ORDER_COMPLETED,
      makeOrder({
        id: ORDER_COMPLETED,
        status: 'COMPLETED',
        completedAt: new Date(),
        destinationLatitude: 22.79,
        destinationLongitude: -82.5,
      }),
    );
    const { json } = await trackingOf(ORDER_COMPLETED);
    expect(json?.data.route).toBeNull();
    expect(getRoute).not.toHaveBeenCalled();
  });

  it('si el motor de rutas falla, el seguimiento responde 200 igual y solo falta la ruta', async () => {
    getRoute.mockRejectedValue(new Error('motor caído'));
    withPin();
    seedLocation();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { status, json } = await trackingOf(ORDER_ASSIGNED);
      expect(status).toBe(200);
      expect(json?.data).toMatchObject({
        trackingActive: true,
        deliverer: { name: 'Saúl' },
        route: null,
      });
      expect(json?.data.location).not.toBeNull();
      await settle();
    }
  });

  it('un cliente sin acceso al pedido (403) no dispara ningún cálculo de ruta', async () => {
    db.orders.set(
      ORDER_OTHERS,
      makeOrder({
        id: ORDER_OTHERS,
        customerId: OTHER,
        destinationLatitude: 22.79,
        destinationLongitude: -82.5,
      }),
    );
    seedLocation();
    const { status } = await trackingOf(ORDER_OTHERS);
    expect(status).toBe(403);
    expect(getRoute).not.toHaveBeenCalled();
  });
});

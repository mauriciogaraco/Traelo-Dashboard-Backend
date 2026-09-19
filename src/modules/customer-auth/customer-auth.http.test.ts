// Pruebas HTTP reales (express en un puerto efímero + fetch) de la autenticación de clientes:
// rutas, middlewares, rate limits, alias /me, IDOR y forma de las respuestas. Los repositorios
// están simulados: no requieren base de datos.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// Debe importarse antes que cualquier módulo que use customer-auth.repository (ver vi.mock).
import {
  createFakeRepository,
  delegatingRepositoryModule,
  fakeHolder,
} from './fake-customer-auth.repository';
import { env } from '../../config/env';
import { authenticate } from '../../middlewares/authenticate';
import { errorHandler } from '../../middlewares/errorHandler';
import { customersRouter } from '../customers/customers.routes';
import { createCustomerAuthRouter } from './customer-auth.routes';
import {
  buildCustomerAuthLimiters,
  DEFAULT_CUSTOMER_AUTH_LIMITS,
} from './customer-auth.rate-limit';
import { setRecoveryChannel } from './recovery-channel';

vi.mock('./customer-auth.repository', () => delegatingRepositoryModule());

// La API key tiene su propia validación; acá interesa lo que va detrás.
vi.mock('../../middlewares/apiKeyAuth', () => ({
  apiKeyAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// customers.repository simulado: devuelve filas CON passwordHash para comprobar que el DTO
// lo elimina antes de salir.
const customerRows = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock('../customers/customers.repository', () => ({
  findById: vi.fn(async (id: string) => customerRows.get(id) ?? null),
  findByPhone: vi.fn(async () => null),
  create: vi.fn(),
  update: vi.fn(async (id: string, data: Record<string, unknown>) => {
    const row = { ...customerRows.get(id), ...data };
    customerRows.set(id, row);
    return row;
  }),
  touchLastOrderAt: vi.fn(),
}));

let server: Server;
let baseUrl: string;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/auth/customer',
    createCustomerAuthRouter(
      buildCustomerAuthLimiters({
        ...DEFAULT_CUSTOMER_AUTH_LIMITS,
        loginByPhone: { windowMs: 60_000, limit: 3 },
        // Los tests registran muchas cuentas seguidas: el tope de registro se sube aparte.
        register: { windowMs: 60_000, limit: 1000 },
      }),
    ),
  );
  app.use('/api/v1/customers', customersRouter);
  app.get('/staff-only', authenticate, (_req, res) => {
    res.json({ data: 'ok' });
  });
  app.use(errorHandler);
  return app;
}

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
  let json: Record<string, any> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, any>) : null;
  } catch {
    // Respuesta no JSON (p. ej. el 404 por defecto de express).
  }
  return { status: response.status, json };
}

const register = (phone: string, password = 'clave-segura-1') =>
  call('POST', '/api/v1/auth/customer/register', {
    body: { name: 'Ana Prueba', phone, password },
  });

beforeAll(async () => {
  server = await new Promise<Server>((resolve) => {
    const s = buildApp().listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  fakeHolder.current = createFakeRepository();
  customerRows.clear();
  setRecoveryChannel(null);
});

describe('registro y login por HTTP', () => {
  it('register → 201 con tokens y cliente sin passwordHash; login → 200', async () => {
    const created = await register('+53 5 555 1234');
    expect(created.status).toBe(201);
    expect(created.json?.data.accessToken).toBeTruthy();
    expect(created.json?.data.refreshToken).toBeTruthy();
    expect(created.json?.data.customer.phone).toBe('+5355551234'); // canónico
    expect(JSON.stringify(created.json)).not.toMatch(/passwordHash/);

    const login = await call('POST', '/api/v1/auth/customer/login', {
      body: { phone: '+5355551234', password: 'clave-segura-1' },
    });
    expect(login.status).toBe(200);
    expect(JSON.stringify(login.json)).not.toMatch(/passwordHash/);
  });

  it('valida la contraseña en BYTES: 7 bytes → 400; 73 bytes → 400; 72 bytes → ok', async () => {
    expect((await register('+5355551111', '1234567')).status).toBe(400);
    expect((await register('+5355551112', 'a'.repeat(73))).status).toBe(400);
    // 36 letras con acento = 72 bytes: 36 caracteres pero justo en el límite.
    expect((await register('+5355551113', 'é'.repeat(36))).status).toBe(201);
    expect((await register('+5355551114', 'é'.repeat(37))).status).toBe(400);
  });

  it('un teléfono repetido responde 409 PHONE_ALREADY_REGISTERED con la forma uniforme de error', async () => {
    await register('+5355551234');
    const duplicate = await register('+53 5555 1234');
    expect(duplicate.status).toBe(409);
    expect(duplicate.json).toMatchObject({ code: 'PHONE_ALREADY_REGISTERED' });
  });

  it('login incorrecto → 401 genérico', async () => {
    await register('+5355551234');
    const bad = await call('POST', '/api/v1/auth/customer/login', {
      body: { phone: '+5355551234', password: 'incorrecta-123' },
    });
    const unknown = await call('POST', '/api/v1/auth/customer/login', {
      body: { phone: '+5355550000', password: 'incorrecta-123' },
    });
    expect(bad.status).toBe(401);
    expect(bad.json).toEqual(unknown.json);
  });

  it('forgot-password sin canal → 200 con channelAvailable:false', async () => {
    const result = await call('POST', '/api/v1/auth/customer/forgot-password', {
      body: { phone: '+5355551234' },
    });
    expect(result.status).toBe(200);
    expect(result.json?.data.channelAvailable).toBe(false);
  });

  it('refresh y logout por HTTP', async () => {
    const created = await register('+5355551234');
    const refreshed = await call('POST', '/api/v1/auth/customer/refresh', {
      body: { refreshToken: created.json?.data.refreshToken },
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.json?.data.refreshToken).not.toBe(created.json?.data.refreshToken);

    const out = await call('POST', '/api/v1/auth/customer/logout', {
      body: { refreshToken: refreshed.json?.data.refreshToken },
    });
    expect(out.status).toBe(204);

    const after = await call('POST', '/api/v1/auth/customer/refresh', {
      body: { refreshToken: refreshed.json?.data.refreshToken },
    });
    expect(after.status).toBe(401);
  });
});

describe('rate limiting', () => {
  it('bloquea tras N intentos fallidos por teléfono (aunque se escriba distinto) con 429', async () => {
    await register('+5355557001');
    const attempt = (phone: string) =>
      call('POST', '/api/v1/auth/customer/login', { body: { phone, password: 'incorrecta-123' } });

    expect((await attempt('+5355557001')).status).toBe(401);
    expect((await attempt('+53 5555 7001')).status).toBe(401);
    expect((await attempt('+53-5555-7001')).status).toBe(401);
    const blocked = await attempt('+5355557001');
    expect(blocked.status).toBe(429);
    expect(blocked.json).toMatchObject({ code: 'RATE_LIMITED' });

    // Otro teléfono no queda afectado.
    expect((await attempt('+5355559876')).status).toBe(401);
  });

  it('los logins correctos no consumen cupo', async () => {
    await register('+5355552222');
    for (let i = 0; i < 6; i++) {
      const ok = await call('POST', '/api/v1/auth/customer/login', {
        body: { phone: '+5355552222', password: 'clave-segura-1' },
      });
      expect(ok.status).toBe(200);
    }
  });
});

describe('/customers: identidad por token, alias /me e IDOR', () => {
  async function loggedIn(phone: string) {
    const created = await register(phone);
    const id = created.json?.data.customer.id as string;
    customerRows.set(id, {
      id,
      name: 'Ana Prueba',
      phone,
      email: null,
      passwordHash: '$2b$12$hash-secreto',
      phoneVerified: false,
      emailVerified: false,
      active: true,
      lastOrderAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { id, token: created.json?.data.accessToken as string };
  }

  it('sin token → 401 AUTH_REQUIRED', async () => {
    const result = await call('GET', '/api/v1/customers/me');
    expect(result.status).toBe(401);
    expect(result.json).toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('GET /customers/me devuelve el DTO explícito, sin passwordHash', async () => {
    const { id, token } = await loggedIn('+5355551234');
    const result = await call('GET', '/api/v1/customers/me', { token });
    expect(result.status).toBe(200);
    expect(result.json?.data.id).toBe(id);
    expect(JSON.stringify(result.json)).not.toMatch(/passwordHash|hash-secreto/);
    expect(result.json?.data.phoneVerified).toBe(false);
  });

  it('con id explícito propio funciona; con el id de OTRO cliente → 403 (IDOR)', async () => {
    const a = await loggedIn('+5355551234');
    const b = await loggedIn('+5355559999');

    expect((await call('GET', `/api/v1/customers/${a.id}`, { token: a.token })).status).toBe(200);

    const idor = await call('GET', `/api/v1/customers/${b.id}`, { token: a.token });
    expect(idor.status).toBe(403);
    expect(idor.json).toMatchObject({ code: 'CUSTOMER_MISMATCH' });

    // También en las rutas anidadas.
    for (const path of ['orders', 'addresses', 'favorites/businesses']) {
      const nested = await call('GET', `/api/v1/customers/${b.id}/${path}`, { token: a.token });
      expect(nested.status).toBe(403);
    }
  });

  it('el alias /me también protege las rutas anidadas (no da 403 al propio cliente)', async () => {
    const { token } = await loggedIn('+5355551234');
    const nested = await call('GET', '/api/v1/customers/me/orders/no-es-un-cuid/status', { token });
    // Llegó a la validación de la ruta (400), o sea, pasó la identidad.
    expect(nested.status).toBe(400);
  });

  it('POST /customers ya no existe (no se pueden crear clientes solo con un teléfono)', async () => {
    const { token } = await loggedIn('+5355551234');
    const result = await call('POST', '/api/v1/customers', {
      token,
      body: { name: 'Squatter', phone: '+5355550000' },
    });
    expect(result.status).toBe(404);
  });

  it('token vencido → 401 TOKEN_EXPIRED; token de staff o basura → 401 INVALID_TOKEN', async () => {
    const expired = jwt.sign({ sub: 'x', typ: 'customer' }, env.JWT_ACCESS_SECRET, {
      expiresIn: -10,
    });
    expect((await call('GET', '/api/v1/customers/me', { token: expired })).json).toMatchObject({
      code: 'TOKEN_EXPIRED',
    });

    const staffToken = jwt.sign({ sub: 'u1', role: 'ADMIN' }, env.JWT_ACCESS_SECRET);
    const asCustomer = await call('GET', '/api/v1/customers/me', { token: staffToken });
    expect(asCustomer.status).toBe(401);
    expect(asCustomer.json).toMatchObject({ code: 'INVALID_TOKEN' });

    expect((await call('GET', '/api/v1/customers/me', { token: 'basura' })).status).toBe(401);
  });

  it('un token firmado con otro secreto es rechazado', async () => {
    const forged = jwt.sign({ sub: 'x', typ: 'customer' }, 'otro-secreto-cualquiera-123');
    expect((await call('GET', '/api/v1/customers/me', { token: forged })).status).toBe(401);
  });
});

describe('separación de identidades staff/cliente', () => {
  it('un token de cliente NO abre rutas de staff', async () => {
    const created = await register('+5355551234');
    const result = await call('GET', '/staff-only', { token: created.json?.data.accessToken });
    expect(result.status).toBe(401);
  });

  it('un token de staff sigue abriendo rutas de staff', async () => {
    const staffToken = jwt.sign({ sub: 'u1', role: 'ADMIN' }, env.JWT_ACCESS_SECRET);
    expect((await call('GET', '/staff-only', { token: staffToken })).status).toBe(200);
  });
});

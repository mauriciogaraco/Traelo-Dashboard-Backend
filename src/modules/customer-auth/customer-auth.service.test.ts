import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcrypt';
import { AppError } from '../../shared/errors';
import {
  createFakeRepository,
  delegatingRepositoryModule,
  fakeHolder,
} from './fake-customer-auth.repository';
import { setRecoveryChannel, type RecoveryChannel } from './recovery-channel';
import * as service from './customer-auth.service';
import {
  hashToken,
  REFRESH_ROTATION_GRACE_MS,
  verifyCustomerAccessToken,
} from './customer-token.service';

vi.mock('./customer-auth.repository', () => delegatingRepositoryModule());

const ctx = { userAgent: 'test', ipAddress: '127.0.0.1' };
const PHONE = '+5355551234';
const PASSWORD = 'clave-segura-1';

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
  fakeHolder.current = createFakeRepository();
  setRecoveryChannel(null);
});

afterEach(() => {
  vi.useRealTimers();
  setRecoveryChannel(null);
});

describe('register', () => {
  it('crea la cuenta, guarda hash (nunca la contraseña) y devuelve tokens y un DTO sin passwordHash', async () => {
    const session = await service.register(
      { name: 'Ana', phone: PHONE, password: PASSWORD, email: 'ana@mail.com' },
      ctx,
    );

    expect(verifyCustomerAccessToken(session.accessToken)).toEqual({
      ok: true,
      customerId: session.customer.id,
    });
    expect(session.refreshToken.length).toBeGreaterThan(40);
    expect(session.customer).not.toHaveProperty('passwordHash');
    expect(session.customer.phoneVerified).toBe(false);
    expect(session.customer.emailVerified).toBe(false);

    const stored = fakeHolder.current.state.customers.get(session.customer.id);
    expect(stored?.passwordHash).not.toBe(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, stored?.passwordHash as string)).toBe(true);
  });

  it('teléfono ya registrado con contraseña → 409 PHONE_ALREADY_REGISTERED', async () => {
    await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    await expectAppError(
      service.register({ name: 'Otra', phone: PHONE, password: 'otra-clave-99' }, ctx),
      409,
      'PHONE_ALREADY_REGISTERED',
    );
  });

  it('reclama un registro heredado SIN contraseña y SIN pedidos, y descarta lo que colgaba de él', async () => {
    const legacy = fakeHolder.current.seedCustomer({ phone: PHONE, name: 'Viejo' });

    const session = await service.register(
      { name: 'Nueva', phone: PHONE, password: PASSWORD },
      ctx,
    );

    expect(session.customer.id).toBe(legacy.id);
    expect(session.customer.name).toBe('Nueva');
    expect(fakeHolder.current.state.customers.get(legacy.id)?.passwordHash).toBeTruthy();
    expect(fakeHolder.current.state.dependents.get(legacy.id)).toBe(0);
  });

  it('NO reclama un registro sin contraseña que ya tiene pedidos (mismo error, no revela el historial)', async () => {
    const legacy = fakeHolder.current.seedCustomer({ phone: PHONE });
    fakeHolder.current.state.orderCounts.set(legacy.id, 2);

    await expectAppError(
      service.register({ name: 'Intruso', phone: PHONE, password: PASSWORD }, ctx),
      409,
      'PHONE_ALREADY_REGISTERED',
    );
    expect(fakeHolder.current.state.customers.get(legacy.id)?.passwordHash).toBeNull();
  });

  it('no reclama una cuenta desactivada', async () => {
    fakeHolder.current.seedCustomer({ phone: PHONE, active: false });
    await expectAppError(
      service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx),
      409,
      'PHONE_ALREADY_REGISTERED',
    );
  });

  it('carrera: si el unique de la BD rechaza el alta, responde 409 y no un 500', async () => {
    const repo = fakeHolder.current;
    repo.findCustomerByPhone = async () => null; // ambas requests pasaron el chequeo previo
    repo.seedCustomer({ phone: PHONE, passwordHash: 'x' });

    await expectAppError(
      service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx),
      409,
      'PHONE_ALREADY_REGISTERED',
    );
  });
});

describe('login', () => {
  it('con teléfono y contraseña correctos devuelve la sesión', async () => {
    await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    const session = await service.login({ phone: PHONE, password: PASSWORD }, ctx);
    expect(session.customer.phone).toBe(PHONE);
    expect(verifyCustomerAccessToken(session.accessToken).ok).toBe(true);
  });

  it('contraseña errónea, teléfono inexistente y cuenta sin contraseña dan EL MISMO error genérico', async () => {
    await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    fakeHolder.current.seedCustomer({ phone: '+5355559999' }); // sin contraseña

    const failures = await Promise.all(
      [
        { phone: PHONE, password: 'incorrecta-123' },
        { phone: '+5355550000', password: PASSWORD },
        { phone: '+5355559999', password: PASSWORD },
      ].map((input) =>
        service.login(input, ctx).then(
          () => null,
          (e: unknown) => e as AppError,
        ),
      ),
    );

    for (const failure of failures) {
      expect(failure?.statusCode).toBe(401);
      expect(failure?.code).toBe('INVALID_CREDENTIALS');
      expect(failure?.message).toBe(failures[0]?.message);
    }
  });

  it('una cuenta desactivada no puede iniciar sesión', async () => {
    const session = await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    const stored = fakeHolder.current.state.customers.get(session.customer.id);
    if (stored) stored.active = false;

    await expectAppError(
      service.login({ phone: PHONE, password: PASSWORD }, ctx),
      401,
      'INVALID_CREDENTIALS',
    );
  });

  it('gasta un bcrypt.compare incluso cuando la cuenta no existe (igualar tiempos)', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    await service.login({ phone: '+5355550000', password: PASSWORD }, ctx).catch(() => null);
    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockRestore();
  });
});

describe('refresh (rotación con ventana de gracia)', () => {
  it('entrega tokens nuevos y el viejo sigue valiendo durante ~2 minutos (reintento con mala conexión)', async () => {
    const session = await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);

    const first = await service.refresh(session.refreshToken, ctx);
    expect(first.refreshToken).not.toBe(session.refreshToken);

    // La respuesta se "perdió": el cliente reintenta con el token viejo, todavía dentro de la gracia.
    const retry = await service.refresh(session.refreshToken, ctx);
    expect(verifyCustomerAccessToken(retry.accessToken).ok).toBe(true);
  });

  it('pasada la ventana de gracia el token viejo ya no sirve, pero el nuevo sí', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const session = await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    const rotated = await service.refresh(session.refreshToken, ctx);

    vi.setSystemTime(Date.now() + REFRESH_ROTATION_GRACE_MS + 1000);

    await expectAppError(service.refresh(session.refreshToken, ctx), 401, 'INVALID_REFRESH_TOKEN');
    await expect(service.refresh(rotated.refreshToken, ctx)).resolves.toBeTruthy();
  });

  it('la sesión es deslizante: cada refresh entrega un token con la vigencia completa', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const session = await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    const original = fakeHolder.current.state.refreshTokens.values().next().value;
    const originalExpiry = original?.expiresAt.getTime() as number;

    vi.setSystemTime(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 días después
    const rotated = await service.refresh(session.refreshToken, ctx);

    const newRecord = [...fakeHolder.current.state.refreshTokens.values()].find(
      (t) => t.tokenHash === hashToken(rotated.refreshToken),
    );
    expect((newRecord?.expiresAt.getTime() as number) - originalExpiry).toBeGreaterThan(
      29 * 24 * 60 * 60 * 1000,
    );
  });

  it('rechaza tokens desconocidos, expirados o revocados', async () => {
    await expectAppError(service.refresh('no-existe', ctx), 401, 'INVALID_REFRESH_TOKEN');

    const session = await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    const record = fakeHolder.current.state.refreshTokens.values().next().value;
    if (record) record.expiresAt = new Date(Date.now() - 1000);
    await expectAppError(service.refresh(session.refreshToken, ctx), 401, 'INVALID_REFRESH_TOKEN');
  });

  it('rechaza el refresh de una cuenta desactivada', async () => {
    const session = await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    const stored = fakeHolder.current.state.customers.get(session.customer.id);
    if (stored) stored.active = false;
    await expectAppError(service.refresh(session.refreshToken, ctx), 401, 'INVALID_REFRESH_TOKEN');
  });
});

describe('logout', () => {
  it('revoca el token presentado (aunque esté en gracia) y es idempotente', async () => {
    const session = await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    const rotated = await service.refresh(session.refreshToken, ctx);

    await service.logout(rotated.refreshToken);
    await service.logout(rotated.refreshToken); // segunda vez: sin error
    await service.logout('token-desconocido');

    await expectAppError(service.refresh(rotated.refreshToken, ctx), 401, 'INVALID_REFRESH_TOKEN');
  });

  it('solo cierra la sesión presentada, no las de otros dispositivos', async () => {
    const a = await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    const b = await service.login({ phone: PHONE, password: PASSWORD }, ctx);

    await service.logout(a.refreshToken);

    await expect(service.refresh(b.refreshToken, ctx)).resolves.toBeTruthy();
  });
});

describe('recuperación de contraseña', () => {
  it('sin canal configurado: channelAvailable=false y NO se genera ningún token', async () => {
    await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);

    const result = await service.forgotPassword({ phone: PHONE });

    expect(result.channelAvailable).toBe(false);
    expect(result.message).toMatch(/WhatsApp/);
    expect(fakeHolder.current.state.resetTokens.size).toBe(0);
  });

  it('la respuesta es idéntica para un teléfono con cuenta y uno sin cuenta (anti-enumeración)', async () => {
    await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    const known = await service.forgotPassword({ phone: PHONE });
    const unknown = await service.forgotPassword({ phone: '+5355550000' });
    expect(known).toEqual(unknown);

    const send = vi.fn().mockResolvedValue(undefined);
    setRecoveryChannel({ send });
    const knownWithChannel = await service.forgotPassword({ phone: PHONE });
    const unknownWithChannel = await service.forgotPassword({ phone: '+5355550000' });
    expect(knownWithChannel).toEqual(unknownWithChannel);
    expect(knownWithChannel.channelAvailable).toBe(true);
  });

  it('con canal: guarda solo el HASH, expira, entrega el token en claro solo al canal y sirve una vez', async () => {
    const session = await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    let delivered = '';
    const channel: RecoveryChannel = {
      send: async (_recipient, rawToken) => {
        delivered = rawToken;
      },
    };

    await service.processRecovery(channel, PHONE);

    const [record] = [...fakeHolder.current.state.resetTokens.values()];
    expect(record?.tokenHash).toBe(hashToken(delivered));
    expect(record?.tokenHash).not.toBe(delivered);
    expect((record?.expiresAt.getTime() as number) - Date.now()).toBeLessThanOrEqual(
      30 * 60 * 1000,
    );

    await service.resetPassword({ token: delivered, newPassword: 'nueva-clave-77' });
    expect(session.customer.id).toBeTruthy();

    // La nueva contraseña funciona, la vieja no.
    await expect(
      service.login({ phone: PHONE, password: 'nueva-clave-77' }, ctx),
    ).resolves.toBeTruthy();
    await expectAppError(
      service.login({ phone: PHONE, password: PASSWORD }, ctx),
      401,
      'INVALID_CREDENTIALS',
    );

    // Un solo uso.
    await expectAppError(
      service.resetPassword({ token: delivered, newPassword: 'otra-clave-88' }),
      400,
      'INVALID_RESET_TOKEN',
    );
  });

  it('el reset revoca TODAS las sesiones, incluidas las que estaban en ventana de gracia', async () => {
    const session = await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    const rotated = await service.refresh(session.refreshToken, ctx); // deja `session` en gracia
    let delivered = '';
    await service.processRecovery({ send: async (_r, token) => void (delivered = token) }, PHONE);

    await service.resetPassword({ token: delivered, newPassword: 'nueva-clave-77' });

    await expectAppError(service.refresh(rotated.refreshToken, ctx), 401, 'INVALID_REFRESH_TOKEN');
    await expectAppError(service.refresh(session.refreshToken, ctx), 401, 'INVALID_REFRESH_TOKEN');
  });

  it('un token vencido o inventado es rechazado con el mismo error', async () => {
    await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    let delivered = '';
    await service.processRecovery({ send: async (_r, token) => void (delivered = token) }, PHONE);

    await expectAppError(
      service.resetPassword({ token: 'inventado', newPassword: 'nueva-clave-77' }),
      400,
      'INVALID_RESET_TOKEN',
    );

    const [record] = [...fakeHolder.current.state.resetTokens.values()];
    if (record) record.expiresAt = new Date(Date.now() - 1000);
    await expectAppError(
      service.resetPassword({ token: delivered, newPassword: 'nueva-clave-77' }),
      400,
      'INVALID_RESET_TOKEN',
    );
  });

  it('pedir otro código invalida el anterior', async () => {
    await service.register({ name: 'Ana', phone: PHONE, password: PASSWORD }, ctx);
    const tokens: string[] = [];
    const channel: RecoveryChannel = { send: async (_r, token) => void tokens.push(token) };

    await service.processRecovery(channel, PHONE);
    await service.processRecovery(channel, PHONE);

    await expectAppError(
      service.resetPassword({ token: tokens[0] as string, newPassword: 'nueva-clave-77' }),
      400,
      'INVALID_RESET_TOKEN',
    );
    await expect(
      service.resetPassword({ token: tokens[1] as string, newPassword: 'nueva-clave-77' }),
    ).resolves.toBeUndefined();
  });

  it('un teléfono sin cuenta no genera token ni llama al canal', async () => {
    const send = vi.fn();
    await service.processRecovery({ send }, '+5355550000');
    expect(send).not.toHaveBeenCalled();
    expect(fakeHolder.current.state.resetTokens.size).toBe(0);
  });
});

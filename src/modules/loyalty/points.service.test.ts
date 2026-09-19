// Pruebas del servicio de puntos con un repositorio en memoria que imita el libro mayor real
// (movimientos inmutables, saldo, primer movimiento = crédito inicial). La transacción y el
// bloqueo reales se prueban en points.integration.test.ts (requiere la migración aplicada).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  orders: new Map<string, Record<string, unknown>>(),
  ledger: [] as { orderId: string; points: number; type: string }[],
  balances: new Map<string, number>(),
  config: {
    pointsServiceDivisor: 10,
    pointsEnabledFrom: new Date('2026-09-19T00:00:00Z'),
  },
  pushes: [] as {
    customerId: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }[],
  pushShouldFail: false,
}));

vi.mock('../../config/system-config.service', () => ({
  getSystemConfig: vi.fn(async () => db.config),
}));

vi.mock('../../shared/push/expo-push', () => ({
  sendPushToCustomer: vi.fn(
    async (
      customerId: string,
      message: { title: string; body: string; data?: Record<string, unknown> },
    ) => {
      if (db.pushShouldFail) throw new Error('push caído');
      db.pushes.push({ customerId, ...message });
    },
  ),
}));

vi.mock('./points.repository', () => ({
  findOrderForPoints: vi.fn(async (orderId: string) => db.orders.get(orderId) ?? null),
  applyOrderPointsDelta: vi.fn(
    async (p: { orderId: string; customerId: string; expected: number }) => {
      const mine = db.ledger.filter((t) => t.orderId === p.orderId);
      const delta = p.expected - mine.reduce((sum, t) => sum + t.points, 0);
      if (delta === 0) return null;
      const first = mine.length === 0;
      const balanceAfter = (db.balances.get(p.customerId) ?? 0) + delta;
      db.balances.set(p.customerId, balanceAfter);
      db.ledger.push({
        orderId: p.orderId,
        points: delta,
        type: first ? 'ORDER_COMPLETED' : 'ORDER_ADJUSTMENT',
      });
      return {
        type: first ? 'ORDER_COMPLETED' : 'ORDER_ADJUSTMENT',
        points: delta,
        balanceAfter,
        first,
      };
    },
  ),
  findCustomerPoints: vi.fn(),
  listTransactions: vi.fn(),
}));

import * as service from './points.service';

const seedOrder = (overrides: Record<string, unknown> = {}) => {
  const order = {
    id: 'o1',
    orderNumber: 1234,
    status: 'COMPLETED',
    source: 'APP',
    customerId: 'c1',
    completedAt: new Date('2026-09-20T12:00:00Z'),
    platformFee: 50,
    ...overrides,
  };
  db.orders.set(order.id as string, order);
  return order;
};

beforeEach(() => {
  db.orders.clear();
  db.ledger.length = 0;
  db.balances.clear();
  db.pushes.length = 0;
  db.pushShouldFail = false;
  db.config.pointsServiceDivisor = 10;
});

describe('acreditar al completar', () => {
  it('50 CUP de servicio → 5 puntos, saldo 5 y aviso "Recibiste 5 puntos"', async () => {
    seedOrder({ platformFee: 50 });

    const result = await service.syncOrderPoints('o1');

    expect(result).toEqual({ points: 5, balanceAfter: 5, first: true });
    expect(db.ledger).toEqual([{ orderId: 'o1', points: 5, type: 'ORDER_COMPLETED' }]);
    expect(db.pushes).toHaveLength(1);
    expect(db.pushes[0]).toMatchObject({
      customerId: 'c1',
      title: '¡Ganaste puntos!',
      body: 'Recibiste 5 puntos por tu pedido #1234.',
      data: { type: 'points', kind: 'EARNED', orderId: 'o1', points: 5 },
    });
  });

  it('es idempotente: sincronizar otra vez (reintento, doble clic, reproceso) NO duplica puntos ni avisos', async () => {
    seedOrder({ platformFee: 50 });
    await service.syncOrderPoints('o1');
    await service.syncOrderPoints('o1');
    await service.syncOrderPoints('o1');

    expect(db.ledger).toHaveLength(1);
    expect(db.balances.get('c1')).toBe(5);
    expect(db.pushes).toHaveLength(1);
  });

  it('los puntos son enteros: 29 CUP → 2 puntos', async () => {
    seedOrder({ platformFee: 29 });
    await service.syncOrderPoints('o1');
    expect(db.balances.get('c1')).toBe(2);
  });

  it('respeta el divisor configurado', async () => {
    db.config.pointsServiceDivisor = 5;
    seedOrder({ platformFee: 50 });
    await service.syncOrderPoints('o1');
    expect(db.balances.get('c1')).toBe(10);
  });
});

describe('cuándo NO hay puntos', () => {
  it.each(['PENDING', 'ASSIGNED', 'CANCELLED'])(
    'pedido %s: sin puntos, sin movimiento y sin aviso',
    async (status) => {
      seedOrder({ status, completedAt: null });
      expect(await service.syncOrderPoints('o1')).toBeNull();
      expect(db.ledger).toHaveLength(0);
      expect(db.pushes).toHaveLength(0);
    },
  );

  it('invitado (sin cuenta): sin puntos', async () => {
    seedOrder({ customerId: null });
    expect(await service.syncOrderPoints('o1')).toBeNull();
    expect(db.ledger).toHaveLength(0);
  });

  it('pedido manual del dashboard: sin puntos aunque tenga cliente', async () => {
    seedOrder({ source: 'MANUAL' });
    expect(await service.syncOrderPoints('o1')).toBeNull();
    expect(db.ledger).toHaveLength(0);
  });

  it('servicio en 0: sin puntos y sin registrar un movimiento vacío', async () => {
    seedOrder({ platformFee: 0 });
    expect(await service.syncOrderPoints('o1')).toBeNull();
    expect(db.ledger).toHaveLength(0);
    expect(db.pushes).toHaveLength(0);
  });

  it('pedido inexistente: no hace nada', async () => {
    expect(await service.syncOrderPoints('no-existe')).toBeNull();
  });

  it('completado antes de activar el sistema: no da puntos ni siquiera al editarlo', async () => {
    seedOrder({ completedAt: new Date('2026-09-10T12:00:00Z'), platformFee: 100 });
    expect(await service.syncOrderPoints('o1')).toBeNull();
    expect(db.ledger).toHaveLength(0);
  });
});

describe('corrección de un pedido ya completado', () => {
  it('el servicio SUBE: se agrega la diferencia como ajuste y se avisa "corrección de administración"', async () => {
    seedOrder({ platformFee: 50 });
    await service.syncOrderPoints('o1'); // +5

    seedOrder({ platformFee: 80 });
    const result = await service.syncOrderPoints('o1');

    expect(result).toEqual({ points: 3, balanceAfter: 8, first: false });
    expect(db.ledger.map((t) => [t.type, t.points])).toEqual([
      ['ORDER_COMPLETED', 5],
      ['ORDER_ADJUSTMENT', 3],
    ]);
    expect(db.pushes[1]).toMatchObject({
      title: 'Ajuste de puntos',
      body: 'Recibiste 3 puntos adicionales por una corrección de administración en tu pedido #1234.',
      data: { kind: 'ADDED', points: 3 },
    });
  });

  it('el servicio BAJA: se retiran los puntos dados de más y se le explica al cliente', async () => {
    seedOrder({ platformFee: 100 });
    await service.syncOrderPoints('o1'); // +10

    seedOrder({ platformFee: 60 });
    const result = await service.syncOrderPoints('o1');

    expect(result).toEqual({ points: -4, balanceAfter: 6, first: false });
    expect(db.pushes[1]).toMatchObject({
      body: 'Se retiraron 4 puntos de tu pedido #1234 por una corrección de administración: se acreditaron por error.',
      data: { kind: 'REMOVED', points: -4 },
    });
  });

  it('el servicio pasa a 0: se retiran TODOS los puntos del pedido', async () => {
    seedOrder({ platformFee: 50 });
    await service.syncOrderPoints('o1');
    seedOrder({ platformFee: 0 });
    await service.syncOrderPoints('o1');

    expect(db.balances.get('c1')).toBe(0);
    expect(db.ledger.reduce((sum, t) => sum + t.points, 0)).toBe(0);
  });

  it('un pedido que ganó 0 y luego se corrige al alza recibe el crédito inicial, no un "ajuste"', async () => {
    seedOrder({ platformFee: 0 });
    await service.syncOrderPoints('o1'); // nada
    seedOrder({ platformFee: 40 });
    const result = await service.syncOrderPoints('o1');

    expect(result).toMatchObject({ points: 4, first: true });
    expect(db.pushes[0]?.title).toBe('¡Ganaste puntos!');
  });

  it('una corrección que no cambia el resultado (44 → 47 CUP: sigue siendo 4 puntos) no mueve nada ni avisa', async () => {
    seedOrder({ platformFee: 44 });
    await service.syncOrderPoints('o1');
    seedOrder({ platformFee: 47 });

    expect(await service.syncOrderPoints('o1')).toBeNull();
    expect(db.ledger).toHaveLength(1);
    expect(db.pushes).toHaveLength(1);
  });

  it('el libro mayor nunca se reescribe: la suma de movimientos siempre coincide con el saldo', async () => {
    for (const fee of [50, 80, 30, 0, 120, 90]) {
      seedOrder({ platformFee: fee });
      await service.syncOrderPoints('o1');
      expect(db.ledger.reduce((sum, t) => sum + t.points, 0)).toBe(db.balances.get('c1') ?? 0);
    }
    expect(db.balances.get('c1')).toBe(9);
  });
});

describe('robustez', () => {
  it('si falla el envío del push, los puntos IGUAL quedan acreditados (syncOrderPoints lo propaga, la versión segura no)', async () => {
    seedOrder({ platformFee: 50 });
    db.pushShouldFail = true;

    await expect(service.syncOrderPointsSafely('o1')).resolves.toBeUndefined();
    expect(db.balances.get('c1')).toBe(5);
    expect(db.ledger).toHaveLength(1);
  });

  it('syncOrderPointsSafely nunca lanza: un fallo de puntos no rompe completar el pedido', async () => {
    const repository = await import('./points.repository');
    vi.mocked(repository.findOrderForPoints).mockRejectedValueOnce(new Error('BD caída'));

    await expect(service.syncOrderPointsSafely('o1')).resolves.toBeUndefined();
  });

  it('y como es idempotente, la siguiente sincronización recupera los puntos que faltaron', async () => {
    seedOrder({ platformFee: 50 });
    const repository = await import('./points.repository');
    vi.mocked(repository.findOrderForPoints).mockRejectedValueOnce(new Error('BD caída'));

    await service.syncOrderPointsSafely('o1'); // falló: 0 puntos
    expect(db.balances.get('c1') ?? 0).toBe(0);

    await service.syncOrderPointsSafely('o1'); // reintento
    expect(db.balances.get('c1')).toBe(5);
  });
});

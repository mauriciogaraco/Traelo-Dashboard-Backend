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
    pointsFirstOrderBonus: 0,
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
  // Imita la transacción real: servicio = diferencia contra lo ya registrado del pedido; bono =
  // una sola vez por cliente y solo si NO hay un pedido completado desde la app anterior.
  applyOrderPointsDelta: vi.fn(
    async (p: {
      orderId: string;
      customerId: string;
      completedAt: Date | null;
      expected: number;
      bonusPoints: number;
    }) => {
      let balance = db.balances.get(p.customerId) ?? 0;
      const mine = db.ledger.filter(
        (t) => t.orderId === p.orderId && t.type !== 'FIRST_ORDER_BONUS',
      );
      const delta = p.expected - mine.reduce((sum, t) => sum + t.points, 0);
      let service: { type: string; points: number; first: boolean } | null = null;
      if (delta !== 0) {
        const first = mine.length === 0;
        const type = first ? 'ORDER_COMPLETED' : 'ORDER_ADJUSTMENT';
        balance += delta;
        db.ledger.push({ orderId: p.orderId, points: delta, type });
        service = { type, points: delta, first };
      }

      let bonus = 0;
      if (p.bonusPoints > 0 && p.completedAt) {
        const completedAt = p.completedAt;
        const alreadyGiven = db.ledger.some(
          (t) =>
            t.type === 'FIRST_ORDER_BONUS' && db.orders.get(t.orderId)?.customerId === p.customerId,
        );
        const earlier = [...db.orders.values()].some(
          (o) =>
            o.customerId === p.customerId &&
            o.id !== p.orderId &&
            ['APP', 'WEB'].includes(o.source as string) &&
            o.status === 'COMPLETED' &&
            ((o.completedAt as Date) < completedAt ||
              ((o.completedAt as Date).getTime() === completedAt.getTime() &&
                (o.id as string) < p.orderId)),
        );
        if (!alreadyGiven && !earlier) {
          balance += p.bonusPoints;
          db.ledger.push({ orderId: p.orderId, points: p.bonusPoints, type: 'FIRST_ORDER_BONUS' });
          bonus = p.bonusPoints;
        }
      }

      if (!service && bonus === 0) return null;
      db.balances.set(p.customerId, balance);
      return { service, bonus, balanceAfter: balance };
    },
  ),
  findCustomerPoints: vi.fn(),
  listTransactions: vi.fn(),
}));

import * as repository from './points.repository';
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
  db.config.pointsFirstOrderBonus = 0; // los tests del bono lo activan a propósito
});

describe('acreditar al completar', () => {
  it('50 CUP de servicio → 5 puntos, saldo 5 y aviso "Recibiste 5 puntos"', async () => {
    seedOrder({ platformFee: 50 });

    const result = await service.syncOrderPoints('o1');

    expect(result).toEqual({ points: 5, bonus: 0, balanceAfter: 5, first: true });
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

    expect(result).toEqual({ points: 3, bonus: 0, balanceAfter: 8, first: false });
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

    expect(result).toEqual({ points: -4, bonus: 0, balanceAfter: 6, first: false });
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
    vi.mocked(repository.findOrderForPoints).mockRejectedValueOnce(new Error('BD caída'));

    await expect(service.syncOrderPointsSafely('o1')).resolves.toBeUndefined();
  });

  it('y como es idempotente, la siguiente sincronización recupera los puntos que faltaron', async () => {
    seedOrder({ platformFee: 50 });
    vi.mocked(repository.findOrderForPoints).mockRejectedValueOnce(new Error('BD caída'));

    await service.syncOrderPointsSafely('o1'); // falló: 0 puntos
    expect(db.balances.get('c1') ?? 0).toBe(0);

    await service.syncOrderPointsSafely('o1'); // reintento
    expect(db.balances.get('c1')).toBe(5);
  });
});

describe('bono de bienvenida: primer pedido desde la app', () => {
  beforeEach(() => {
    db.config.pointsFirstOrderBonus = 10;
  });

  it('el primer pedido completado da los puntos de servicio MÁS 10 de bienvenida, en un solo aviso', async () => {
    seedOrder({ platformFee: 50 });

    const result = await service.syncOrderPoints('o1');

    expect(result).toEqual({ points: 5, bonus: 10, balanceAfter: 15, first: true });
    expect(db.ledger.map((t) => [t.type, t.points])).toEqual([
      ['ORDER_COMPLETED', 5],
      ['FIRST_ORDER_BONUS', 10],
    ]);
    expect(db.pushes).toHaveLength(1);
    expect(db.pushes[0]).toMatchObject({
      title: '¡Ganaste puntos!',
      body: 'Recibiste 5 puntos por tu pedido #1234 y 10 puntos de bienvenida por tu primer pedido.',
      data: { points: 15, bonus: 10 },
    });
  });

  it('también lo recibe aunque el servicio sea 0 (aviso solo del bono)', async () => {
    seedOrder({ platformFee: 0 });

    const result = await service.syncOrderPoints('o1');

    expect(result).toMatchObject({ points: 0, bonus: 10, balanceAfter: 10 });
    expect(db.pushes[0]?.title).toBe('¡Puntos de bienvenida!');
  });

  it('el segundo pedido NO vuelve a dar el bono', async () => {
    seedOrder({ id: 'o1', platformFee: 50, completedAt: new Date('2026-09-20T10:00:00Z') });
    await service.syncOrderPoints('o1');
    seedOrder({
      id: 'o2',
      orderNumber: 1235,
      platformFee: 50,
      completedAt: new Date('2026-09-21T10:00:00Z'),
    });

    const result = await service.syncOrderPoints('o2');

    expect(result).toMatchObject({ points: 5, bonus: 0, balanceAfter: 20 });
    expect(db.ledger.filter((t) => t.type === 'FIRST_ORDER_BONUS')).toHaveLength(1);
  });

  it('sincronizar de nuevo el mismo pedido no repite el bono ni el aviso', async () => {
    seedOrder({ platformFee: 50 });
    await service.syncOrderPoints('o1');
    await service.syncOrderPoints('o1');
    await service.syncOrderPoints('o1');

    expect(db.balances.get('c1')).toBe(15);
    expect(db.pushes).toHaveLength(1);
  });

  it('corregir el servicio del primer pedido ajusta solo el servicio: el bono se queda', async () => {
    seedOrder({ platformFee: 50 });
    await service.syncOrderPoints('o1'); // 5 + 10

    seedOrder({ platformFee: 20 });
    const result = await service.syncOrderPoints('o1');

    expect(result).toMatchObject({ points: -3, bonus: 0, balanceAfter: 12, first: false });
    expect(db.ledger.filter((t) => t.type === 'FIRST_ORDER_BONUS')).toHaveLength(1);
  });

  it('un pedido completado ANTES que otro se lleva el bono, aunque se sincronice después', async () => {
    seedOrder({ id: 'o1', platformFee: 50, completedAt: new Date('2026-09-20T10:00:00Z') });
    seedOrder({
      id: 'o2',
      orderNumber: 1235,
      platformFee: 50,
      completedAt: new Date('2026-09-21T10:00:00Z'),
    });

    // Se sincroniza primero el más reciente: no es el primero, no hay bono.
    expect(await service.syncOrderPoints('o2')).toMatchObject({ bonus: 0 });
    // Luego el más antiguo: ese SÍ es el primer pedido.
    expect(await service.syncOrderPoints('o1')).toMatchObject({ bonus: 10 });
    expect(db.balances.get('c1')).toBe(20);
  });

  it('quien ya tenía pedidos completados desde la app antes no lo recibe', async () => {
    seedOrder({ id: 'viejo', platformFee: 0, completedAt: new Date('2026-09-19T08:00:00Z') });
    seedOrder({
      id: 'nuevo',
      orderNumber: 1240,
      platformFee: 50,
      completedAt: new Date('2026-09-25T08:00:00Z'),
    });

    expect(await service.syncOrderPoints('nuevo')).toMatchObject({ points: 5, bonus: 0 });
  });

  it('un pedido manual o de invitado no cuenta como "primer pedido" ni lo recibe', async () => {
    seedOrder({ id: 'manual', source: 'MANUAL', completedAt: new Date('2026-09-20T08:00:00Z') });
    seedOrder({
      id: 'app',
      orderNumber: 1240,
      platformFee: 50,
      completedAt: new Date('2026-09-25T08:00:00Z'),
    });

    expect(await service.syncOrderPoints('manual')).toBeNull();
    // El manual no es "pedido desde la app": el de la app sigue siendo el primero.
    expect(await service.syncOrderPoints('app')).toMatchObject({ points: 5, bonus: 10 });
  });

  it('con el bono en 0 (desactivado) no se da', async () => {
    db.config.pointsFirstOrderBonus = 0;
    seedOrder({ platformFee: 50 });
    expect(await service.syncOrderPoints('o1')).toMatchObject({ points: 5, bonus: 0 });
  });

  it('un pedido cancelado no da el bono', async () => {
    seedOrder({ status: 'CANCELLED', completedAt: null });
    expect(await service.syncOrderPoints('o1')).toBeNull();
  });
});

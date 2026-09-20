// Integración de puntos: corre contra la BD de DATABASE_URL y REQUIERE la migración
// 20260919000003_add_loyalty_points aplicada (y las 20260919000001/2 de clientes). Cada test crea
// sus datos y el afterAll los borra. Cubre lo que los unitarios simulan: la transacción real, el
// bloqueo del cliente ante sincronizaciones simultáneas, el unique del crédito inicial y los CHECK.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import * as pointsService from './points.service';

describe('puntos (integración)', () => {
  const stamp = Date.now();
  let customerId: string;
  const orderIds: string[] = [];

  async function createOrder(overrides: Record<string, unknown> = {}) {
    const order = await prisma.order.create({
      data: {
        customerName: 'Cliente Puntos Test',
        customerAddress: 'Calle Test',
        customerPhone: `+53557${stamp}`.slice(0, 20),
        deliveryFee: 250,
        status: 'COMPLETED',
        source: 'APP',
        completedAt: new Date(Date.now() + 60_000), // posterior a pointsEnabledFrom
        customerId,
        productsTotal: 1000,
        platformFee: 50,
        total: 1300,
        traeloEarning: 50,
        delivererEarning: 0,
        ...overrides,
      },
    });
    orderIds.push(order.id);
    return order;
  }

  const balance = async () =>
    (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).pointsBalance;
  const ledgerOf = (orderId: string) =>
    prisma.pointsTransaction.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    customerId = (
      await prisma.customer.create({
        data: { name: 'Cliente Puntos Test', phone: `+53556${stamp}`.slice(0, 20) },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.pointsTransaction.deleteMany({ where: { customerId } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.delete({ where: { id: customerId } });
  });

  it('completar acredita floor(servicio/10), actualiza el saldo y guarda la regla usada', async () => {
    const order = await createOrder({ platformFee: 59 });
    const before = await balance();

    await pointsService.syncOrderPoints(order.id);

    // Es el primer pedido de este cliente: puede sumar además el bono de bienvenida, cuyo valor vive
    // en SystemConfig (que otros archivos de integración modifican en paralelo). Aquí solo se
    // comprueba el crédito del servicio y que el saldo sea exactamente lo registrado en el libro.
    const entries = await ledgerOf(order.id);
    expect((await balance()) - before).toBe(entries.reduce((sum, entry) => sum + entry.points, 0));
    const tx = entries.find((entry) => entry.type === 'ORDER_COMPLETED');
    expect(tx).toMatchObject({
      type: 'ORDER_COMPLETED',
      points: 5,
      divisor: 10,
      dedupeKey: `order-earn:${order.id}`,
    });
    expect(Number(tx?.serviceFee)).toBe(59);
    // balanceAfter es el saldo tras ESTE movimiento (el bono, si lo hay, se asienta después).
    expect(tx?.balanceAfter).toBe(before + 5);
  });

  it('cinco sincronizaciones SIMULTÁNEAS del mismo pedido acreditan una sola vez', async () => {
    const order = await createOrder({ platformFee: 100 });
    const before = await balance();

    await Promise.all(
      Array.from({ length: 5 }, () => pointsService.syncOrderPointsSafely(order.id)),
    );

    expect((await ledgerOf(order.id)).length).toBe(1);
    expect((await balance()) - before).toBe(10);
  });

  it('dos pedidos del mismo cliente sincronizados a la vez no pierden ninguna actualización de saldo', async () => {
    const [a, b] = await Promise.all([
      createOrder({ platformFee: 30 }),
      createOrder({ platformFee: 70 }),
    ]);
    const before = await balance();

    await Promise.all([
      pointsService.syncOrderPointsSafely(a.id),
      pointsService.syncOrderPointsSafely(b.id),
    ]);

    expect((await balance()) - before).toBe(10);
  });

  it('corregir el servicio de un pedido completado suma o retira la diferencia, sin tocar el historial', async () => {
    const order = await createOrder({ platformFee: 50 });
    await pointsService.syncOrderPoints(order.id); // +5
    const before = await balance();

    await prisma.order.update({ where: { id: order.id }, data: { platformFee: 20 } });
    await pointsService.syncOrderPoints(order.id); // -3

    expect((await balance()) - before).toBe(-3);
    const ledger = await ledgerOf(order.id);
    expect(ledger.map((t) => [t.type, t.points])).toEqual([
      ['ORDER_COMPLETED', 5],
      ['ORDER_ADJUSTMENT', -3],
    ]);
    expect(ledger.reduce((sum, t) => sum + t.points, 0)).toBe(2);
  });

  it('no dan puntos: manual, cancelado, servicio 0 e invitado', async () => {
    const before = await balance();
    const manual = await createOrder({ source: 'MANUAL' });
    const cancelled = await createOrder({
      status: 'CANCELLED',
      completedAt: null,
      cancelledAt: new Date(),
    });
    const zero = await createOrder({ platformFee: 0 });
    const guest = await createOrder({ customerId: null });

    for (const order of [manual, cancelled, zero, guest]) {
      await pointsService.syncOrderPointsSafely(order.id);
      expect(await ledgerOf(order.id)).toHaveLength(0);
    }
    expect(await balance()).toBe(before);
  });

  it('la BD impone los invariantes: un movimiento en 0 y una llave repetida se rechazan', async () => {
    const order = await createOrder({ platformFee: 40 });
    await pointsService.syncOrderPoints(order.id);

    await expect(
      prisma.pointsTransaction.create({
        data: {
          customerId,
          type: 'ORDER_ADJUSTMENT',
          points: 0,
          balanceAfter: 0,
          serviceFee: 0,
          divisor: 10,
          reason: 'cero',
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.pointsTransaction.create({
        data: {
          customerId,
          type: 'ORDER_COMPLETED',
          points: 4,
          balanceAfter: 4,
          serviceFee: 40,
          divisor: 10,
          reason: 'duplicado',
          orderId: order.id,
          dedupeKey: `order-earn:${order.id}`,
        },
      }),
    ).rejects.toThrow();
  });
});

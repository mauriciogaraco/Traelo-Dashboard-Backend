// Integración del bono de bienvenida (primer pedido desde la app). Igual que
// points.integration.test.ts: corre contra DATABASE_URL y REQUIERE la migración
// 20260919000003_add_loyalty_points aplicada.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import * as pointsService from './points.service';

describe('bono de primer pedido (integración)', () => {
  const stamp = Date.now();
  let customerId: string;
  const orderIds: string[] = [];

  async function createOrder(minutesFromNow: number, overrides: Record<string, unknown> = {}) {
    const order = await prisma.order.create({
      data: {
        customerName: 'Cliente Bono Test',
        customerAddress: 'Calle Test',
        customerPhone: `+53554${stamp}`.slice(0, 20),
        deliveryFee: 250,
        status: 'COMPLETED',
        source: 'APP',
        completedAt: new Date(Date.now() + minutesFromNow * 60_000),
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
  const bonusRows = () =>
    prisma.pointsTransaction.findMany({ where: { customerId, type: 'FIRST_ORDER_BONUS' } });

  beforeAll(async () => {
    customerId = (
      await prisma.customer.create({
        data: { name: 'Cliente Bono Test', phone: `+53553${stamp}`.slice(0, 20) },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.pointsTransaction.deleteMany({ where: { customerId } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.delete({ where: { id: customerId } });
  });

  it('el primer pedido da servicio + 10 de bienvenida; con llave única por cliente', async () => {
    const first = await createOrder(60);

    await pointsService.syncOrderPoints(first.id);

    expect(await balance()).toBe(15);
    const [bonus] = await bonusRows();
    expect(bonus).toMatchObject({ points: 10, dedupeKey: `first-order-bonus:${customerId}` });
  });

  it('un segundo pedido, y cinco sincronizaciones simultáneas, no repiten el bono', async () => {
    const second = await createOrder(120);

    await Promise.all(
      Array.from({ length: 5 }, () => pointsService.syncOrderPointsSafely(second.id)),
    );

    expect(await bonusRows()).toHaveLength(1);
    expect(await balance()).toBe(20); // 15 + 5 de servicio, sin segundo bono
  });

  it('con dos pedidos completados y sincronizados a la vez, EXACTAMENTE uno recibe el bono', async () => {
    const other = await prisma.customer.create({
      data: { name: 'Cliente Bono 2', phone: `+53552${stamp}`.slice(0, 20) },
    });
    try {
      const make = (minutes: number) =>
        prisma.order.create({
          data: {
            customerName: 'x',
            customerAddress: 'x',
            customerPhone: `+53551${stamp}`.slice(0, 20),
            deliveryFee: 250,
            status: 'COMPLETED',
            source: 'APP',
            completedAt: new Date(Date.now() + minutes * 60_000),
            customerId: other.id,
            productsTotal: 100,
            platformFee: 0,
            total: 350,
            traeloEarning: 0,
            delivererEarning: 0,
          },
        });
      const [a, b] = await Promise.all([make(10), make(20)]);
      orderIds.push(a.id, b.id);

      await Promise.all([
        pointsService.syncOrderPointsSafely(a.id),
        pointsService.syncOrderPointsSafely(b.id),
      ]);

      const rows = await prisma.pointsTransaction.findMany({
        where: { customerId: other.id, type: 'FIRST_ORDER_BONUS' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.orderId).toBe(a.id); // el completado primero
    } finally {
      await prisma.pointsTransaction.deleteMany({ where: { customerId: other.id } });
      await prisma.order.deleteMany({ where: { customerId: other.id } });
      await prisma.customer.delete({ where: { id: other.id } });
    }
  });

  it('un pedido manual no recibe el bono ni impide que el de la app lo reciba', async () => {
    const other = await prisma.customer.create({
      data: { name: 'Cliente Bono 3', phone: `+53550${stamp}`.slice(0, 20) },
    });
    try {
      const manual = await prisma.order.create({
        data: {
          customerName: 'x',
          customerAddress: 'x',
          customerPhone: `+53549${stamp}`.slice(0, 20),
          deliveryFee: 250,
          status: 'COMPLETED',
          source: 'MANUAL',
          completedAt: new Date(Date.now() + 5 * 60_000),
          customerId: other.id,
          productsTotal: 100,
          platformFee: 50,
          total: 400,
          traeloEarning: 50,
          delivererEarning: 0,
        },
      });
      const app = await prisma.order.create({
        data: {
          customerName: 'x',
          customerAddress: 'x',
          customerPhone: `+53549${stamp}`.slice(0, 20),
          deliveryFee: 250,
          status: 'COMPLETED',
          source: 'APP',
          completedAt: new Date(Date.now() + 15 * 60_000),
          customerId: other.id,
          productsTotal: 100,
          platformFee: 50,
          total: 400,
          traeloEarning: 50,
          delivererEarning: 0,
        },
      });
      orderIds.push(manual.id, app.id);

      await pointsService.syncOrderPointsSafely(manual.id);
      await pointsService.syncOrderPointsSafely(app.id);

      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: other.id } });
      expect(customer.pointsBalance).toBe(15);
    } finally {
      await prisma.pointsTransaction.deleteMany({ where: { customerId: other.id } });
      await prisma.order.deleteMany({ where: { customerId: other.id } });
      await prisma.customer.delete({ where: { id: other.id } });
    }
  });
});

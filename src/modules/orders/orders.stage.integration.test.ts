// Integración de las etapas del reparto (Recogiendo / En camino). Corre contra la BD de DATABASE_URL y
// REQUIERE la migración 20260922000001_add_order_delivery_stages. Crea sus propios datos y los borra.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import * as ordersService from './orders.service';

describe('etapas del reparto (integración)', () => {
  const stamp = Date.now();
  const orderIds: string[] = [];
  let userAId = '';
  let userBId = '';
  let delivererA = '';
  let delivererB = '';

  async function makeDeliverer(label: string) {
    const user = await prisma.user.create({
      data: { name: `Mensajero ${label}`, email: `stage-${label}-${stamp}@test.local`, passwordHash: 'x', role: 'DELIVERER' },
    });
    const deliverer = await prisma.deliverer.create({ data: { userId: user.id } });
    return { userId: user.id, delivererId: deliverer.id };
  }

  async function makeOrder(overrides: Record<string, unknown> = {}) {
    const order = await prisma.order.create({
      data: {
        customerName: 'Cliente Etapas Test',
        customerAddress: 'Calle Test',
        customerPhone: `+53556${stamp}`.slice(0, 20),
        deliveryFee: 250,
        status: 'ASSIGNED',
        assignedAt: new Date(),
        delivererId: delivererA,
        source: 'MANUAL',
        productsTotal: 1000,
        total: 1250,
        traeloEarning: 0,
        delivererEarning: 0,
        ...overrides,
      },
    });
    orderIds.push(order.id);
    return order;
  }

  beforeAll(async () => {
    const a = await makeDeliverer('A');
    const b = await makeDeliverer('B');
    userAId = a.userId;
    userBId = b.userId;
    delivererA = a.delivererId;
    delivererB = b.delivererId;
  }, 60_000);

  afterAll(async () => {
    if (orderIds.length > 0) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    const users = [userAId, userBId].filter(Boolean);
    if (users.length > 0) await prisma.user.deleteMany({ where: { id: { in: users } } });
  }, 60_000);

  it('el flujo normal: Confirmado → Recogiendo → En camino, con la hora de cada etapa', async () => {
    const order = await makeOrder();
    expect(order.pickingUpAt).toBeNull();

    const picking = await ordersService.updateOrderStage(order.id, { stage: 'PICKING_UP' });
    expect(picking.status).toBe('ASSIGNED');
    expect(picking.pickingUpAt).toBeInstanceOf(Date);
    expect(picking.onTheWayAt).toBeNull();

    const onTheWay = await ordersService.updateOrderStage(order.id, { stage: 'ON_THE_WAY' });
    expect(onTheWay.status).toBe('ASSIGNED');
    expect(onTheWay.onTheWayAt).toBeInstanceOf(Date);
    expect(onTheWay.pickingUpAt?.getTime()).toBe(picking.pickingUpAt?.getTime());
  });

  it('repetir una etapa no cambia nada (idempotente)', async () => {
    const order = await makeOrder();
    const first = await ordersService.updateOrderStage(order.id, { stage: 'PICKING_UP' });
    const second = await ordersService.updateOrderStage(order.id, { stage: 'PICKING_UP' });
    expect(second.pickingUpAt?.getTime()).toBe(first.pickingUpAt?.getTime());
  });

  it('"En camino" sin haber pasado por "Recogiendo": 409 STAGE_OUT_OF_ORDER', async () => {
    const order = await makeOrder();
    await expect(ordersService.updateOrderStage(order.id, { stage: 'ON_THE_WAY' })).rejects.toMatchObject({
      code: 'STAGE_OUT_OF_ORDER',
      statusCode: 409,
    });
  });

  it('pedir "Recogiendo" cuando ya va en camino no retrocede nada: devuelve el estado actual', async () => {
    const order = await makeOrder({ pickingUpAt: new Date(), onTheWayAt: new Date() });
    const result = await ordersService.updateOrderStage(order.id, { stage: 'PICKING_UP' });
    expect(result.pickingUpAt).toBeInstanceOf(Date);
    expect(result.onTheWayAt).toBeInstanceOf(Date);
  });

  it('solo un pedido ASSIGNED con mensajero cambia de etapa (PENDING, COMPLETED y CANCELLED: 409)', async () => {
    for (const status of ['PENDING', 'COMPLETED', 'CANCELLED'] as const) {
      const order = await makeOrder({ status, delivererId: status === 'PENDING' ? null : delivererA });
      await expect(ordersService.updateOrderStage(order.id, { stage: 'PICKING_UP' })).rejects.toMatchObject({
        code: 'ORDER_NOT_ASSIGNED',
      });
    }
  });

  it('un mensajero solo mueve SUS pedidos: el de otro se ve como inexistente (404)', async () => {
    const order = await makeOrder({ delivererId: delivererA });
    await expect(ordersService.updateOrderStage(order.id, { stage: 'PICKING_UP' }, delivererB)).rejects.toMatchObject({
      statusCode: 404,
    });
    const own = await ordersService.updateOrderStage(order.id, { stage: 'PICKING_UP' }, delivererA);
    expect(own.pickingUpAt).toBeInstanceOf(Date);
  });

  it('reasignar el pedido a OTRO mensajero reinicia las etapas', async () => {
    const order = await makeOrder({ pickingUpAt: new Date(), onTheWayAt: new Date() });
    const reassigned = await ordersService.assignOrder(order.id, { delivererId: delivererB });
    expect(reassigned.pickingUpAt).toBeNull();
    expect(reassigned.onTheWayAt).toBeNull();
    expect(reassigned.status).toBe('ASSIGNED');
  });

  it('reasignar al MISMO mensajero conserva las etapas', async () => {
    const order = await makeOrder({ pickingUpAt: new Date() });
    const same = await ordersService.assignOrder(order.id, { delivererId: delivererA });
    expect(same.pickingUpAt).toBeInstanceOf(Date);
  });

  it('entregar el pedido no depende de las etapas (se puede completar desde Confirmado)', async () => {
    const order = await makeOrder();
    const completed = await ordersService.updateOrderStatus(order.id, { status: 'COMPLETED' });
    expect(completed.status).toBe('COMPLETED');
  });
});

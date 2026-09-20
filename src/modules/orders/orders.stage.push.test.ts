// Push al cliente cuando el reparto avanza de etapa (Recogiendo / En camino), con el repositorio y
// el envío de push en memoria. La escritura real de las etapas se prueba en orders.stage.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  order: null as Record<string, unknown> | null,
  pushes: [] as {
    customerId: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }[],
  pushRejects: false,
}));

vi.mock('./orders.repository', () => ({
  findById: vi.fn(async () => db.order),
  update: vi.fn(async (_id: string, data: Record<string, unknown>) => {
    db.order = { ...db.order, ...data };
    return db.order;
  }),
}));

vi.mock('../../shared/push/expo-push', () => ({
  sendPushToCustomer: vi.fn(
    async (
      customerId: string,
      message: { title: string; body: string; data?: Record<string, unknown> },
    ) => {
      db.pushes.push({ customerId, ...message });
      if (db.pushRejects) throw new Error('push caído');
    },
  ),
}));

import { buildStageNotification } from './order-stage-notifications';
import { updateOrderStage } from './orders.service';

// Un número (no Decimal) sirve: decimalToNumber solo pide un objeto con toNumber().
const money = { toNumber: () => 0 };

// Pedido completo para que toDTO pueda mapearlo.
const baseOrder = {
  id: 'o1',
  orderNumber: 12,
  customerName: 'Cliente',
  customerAddress: 'Calle 1',
  addressReference: null,
  customerPhone: '+5355500000',
  deliveryFee: money,
  status: 'ASSIGNED',
  orderDate: new Date('2026-09-20T10:00:00Z'),
  assignedAt: new Date('2026-09-20T10:05:00Z'),
  pickingUpAt: null,
  onTheWayAt: null,
  completedAt: null,
  cancelledAt: null,
  delivererId: 'd1',
  deliverer: { user: { name: 'Mensajero' } },
  registeredByUserId: null,
  registeredBy: null,
  customerId: 'c1',
  source: 'APP',
  raffleNumber: null,
  productsTotal: money,
  platformFee: money,
  total: money,
  pointsDiscount: money,
  redemption: null,
  traeloEarning: money,
  traeloDeliveryShare: money,
  delivererEarning: money,
  businesses: [],
  createdAt: new Date('2026-09-20T10:00:00Z'),
  updatedAt: new Date('2026-09-20T10:05:00Z'),
};

beforeEach(() => {
  db.order = { ...baseOrder };
  db.pushes = [];
  db.pushRejects = false;
});

describe('buildStageNotification', () => {
  it('Recogiendo: avisa que el mensajero va por el pedido y trae lo que la app necesita para abrirlo', () => {
    const message = buildStageNotification('PICKING_UP', { id: 'o1', orderNumber: 12 });
    expect(message.title).toBe('Tu mensajero va por tu pedido');
    expect(message.body).toContain('#12');
    expect(message.data).toEqual({ type: 'order', stage: 'PICKING_UP', orderId: 'o1' });
  });

  it('En camino: avisa que el pedido ya va hacia el cliente', () => {
    const message = buildStageNotification('ON_THE_WAY', { id: 'o1', orderNumber: 12 });
    expect(message.title).toBe('¡Tu pedido va en camino!');
    expect(message.data).toEqual({ type: 'order', stage: 'ON_THE_WAY', orderId: 'o1' });
  });
});

describe('updateOrderStage — push al cliente', () => {
  it('al pasar a Recogiendo envía UN push al cliente del pedido', async () => {
    await updateOrderStage('o1', { stage: 'PICKING_UP' });
    expect(db.pushes).toHaveLength(1);
    expect(db.pushes[0]).toMatchObject({
      customerId: 'c1',
      data: { stage: 'PICKING_UP', orderId: 'o1' },
    });
  });

  it('al pasar a En camino envía otro push distinto', async () => {
    db.order = { ...baseOrder, pickingUpAt: new Date() };
    await updateOrderStage('o1', { stage: 'ON_THE_WAY' });
    expect(db.pushes).toHaveLength(1);
    expect(db.pushes[0]?.data).toMatchObject({ stage: 'ON_THE_WAY' });
  });

  it('repetir la misma etapa NO vuelve a avisar (el mensajero puede tocar dos veces)', async () => {
    await updateOrderStage('o1', { stage: 'PICKING_UP' });
    await updateOrderStage('o1', { stage: 'PICKING_UP' });
    expect(db.pushes).toHaveLength(1);
  });

  it('un pedido de invitado (sin cliente) cambia de etapa sin intentar ningún push', async () => {
    db.order = { ...baseOrder, customerId: null };
    await updateOrderStage('o1', { stage: 'PICKING_UP' });
    expect(db.pushes).toHaveLength(0);
  });

  it('si la etapa es inválida (En camino sin Recogiendo) no avisa de nada', async () => {
    await expect(updateOrderStage('o1', { stage: 'ON_THE_WAY' })).rejects.toMatchObject({
      code: 'STAGE_OUT_OF_ORDER',
    });
    expect(db.pushes).toHaveLength(0);
  });

  it('un push que falla no rompe el cambio de etapa', async () => {
    db.pushRejects = true;
    await expect(updateOrderStage('o1', { stage: 'PICKING_UP' })).resolves.toBeDefined();
    expect((db.order as { pickingUpAt: unknown }).pickingUpAt).toBeInstanceOf(Date);
  });
});

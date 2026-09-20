// Integración del canje de puntos: corre contra la BD de DATABASE_URL y REQUIERE la migración
// 20260921000001_add_rewards_and_redemptions (y las de puntos/clientes) aplicada. Cada test crea sus
// datos y el afterAll los borra. Cubre lo que los unitarios simulan: la transacción real, el
// descuento condicional del saldo, las carreras entre dispositivos y la idempotencia.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../shared/prisma';
import { CartChangedError } from '../../shared/errors';
import * as businessesService from '../businesses/businesses.service';
import * as productsService from '../businesses/products.service';
import * as customerOrdersService from '../customers/customer-orders.service';
import * as ordersService from '../orders/orders.service';
import * as pointsService from './points.service';
import * as rewardsService from './rewards.service';
import { RedemptionError } from './rewards.rules';

describe('canje de puntos (integración)', () => {
  const stamp = Date.now();
  let businessId: string;
  let pizzaId: string;
  let batidoId: string;
  let soldOutId: string;
  let rewardId: string;
  let soldOutRewardId: string;
  let customerId: string;
  const orderIds: string[] = [];

  const balance = async () =>
    (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).pointsBalance;
  const setBalance = (points: number) =>
    prisma.customer.update({ where: { id: customerId }, data: { pointsBalance: points } });
  const uniqueRequest = (label: string) => `${label}-${stamp}-${Math.random().toString(36).slice(2, 10)}`;

  function checkout(extra: Record<string, unknown> = {}, items = [{ productId: pizzaId, quantity: 1 }, { productId: batidoId, quantity: 1 }]) {
    return customerOrdersService.createCheckoutOrder(
      {
        address: 'Calle Canje #1',
        clientRequestId: uniqueRequest('req'),
        businesses: [{ businessId, items }],
        ...extra,
      } as never,
      customerId,
    );
  }

  async function track<T extends { id: string }>(order: T): Promise<T> {
    orderIds.push(order.id);
    return order;
  }

  beforeAll(async () => {
    const business = await businessesService.createBusiness({
      name: `Negocio Canje Test ${stamp}`,
      phone: '+53 5555 3030',
      address: 'Calle Test C',
      commissionType: 'PERCENTAGE',
      commissionPercentage: 10,
      deliveryFeeBase: 100,
    });
    businessId = business.id;
    await prisma.businessHours.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        businessId,
        dayOfWeek,
        openTime: new Date(Date.UTC(1970, 0, 1, 0, 0)),
        closeTime: new Date(Date.UTC(1970, 0, 1, 23, 59)),
        closed: false,
      })),
    });

    pizzaId = (await productsService.createProduct(businessId, { name: 'Pizza Especial', price: 300 })).id;
    batidoId = (await productsService.createProduct(businessId, { name: 'Batido', price: 150 })).id;
    soldOutId = (await productsService.createProduct(businessId, { name: 'Agotado', price: 200 })).id;
    await productsService.setProductAvailability(businessId, soldOutId, { available: false });

    rewardId = (await rewardsService.createReward({ name: 'Pizza Especial', pointsCost: 300, productId: pizzaId })).id;
    soldOutRewardId = (await rewardsService.createReward({ name: 'Agotado', pointsCost: 100, productId: soldOutId })).id;

    customerId = (
      await prisma.customer.create({
        data: { name: 'Cliente Canje Test', phone: `+53558${stamp}`.slice(0, 20), pointsBalance: 500 },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    // Si beforeAll falló estos ids quedan undefined y Prisma trataría `undefined` como "sin filtro".
    if (customerId) {
      await prisma.pointsTransaction.deleteMany({ where: { customerId } });
      await prisma.order.deleteMany({ where: { customerId } });
      await prisma.customer.delete({ where: { id: customerId } });
    }
    if (businessId) {
      await prisma.reward.deleteMany({ where: { product: { businessId } } }).catch(() => undefined);
      await prisma.business.deleteMany({ where: { id: businessId } });
    }
  }, 60_000);

  // El antispam bloquea un pedido nuevo mientras el anterior siga PENDING. Pasarlo a ASSIGNED
  // directo en la BD lo libera sin efectos secundarios (no dispara devoluciones de puntos).
  afterEach(async () => {
    await prisma.order.updateMany({ where: { customerId, status: 'PENDING' }, data: { status: 'ASSIGNED' } });
  });

  it('pedido con canje: subtotal, mensajería, servicio, total, línea, ledger y saldo', async () => {
    await setBalance(500);
    const order = await track(await checkout({ redemption: { rewardId, expectedBalance: 500 } }));

    expect(order.productsTotal).toBe(450); // el negocio cobra sus productos completos
    expect(order.pointsDiscount).toBe(300);
    // Los puntos solo restan del producto; mensajería y Servicio Tráelo permanecen.
    expect(order.total).toBe(450 - 300 + order.deliveryFee + order.platformFee);
    expect(order.deliveryFee).toBeGreaterThanOrEqual(100);
    expect(order.redemption).toMatchObject({ rewardId, rewardName: 'Pizza Especial', pointsCost: 300, moneyValue: 300, status: 'APPLIED' });

    const pizzaLine = order.businesses[0]?.items.find((item) => item.productId === pizzaId);
    expect(pizzaLine).toMatchObject({ unitPrice: 300, pointsRedeemed: 300, pointsDiscount: 300 });
    const batidoLine = order.businesses[0]?.items.find((item) => item.productId === batidoId);
    expect(batidoLine).toMatchObject({ pointsRedeemed: 0, pointsDiscount: 0 });

    expect(await balance()).toBe(200);
    const ledger = await prisma.pointsTransaction.findMany({ where: { orderId: order.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: 'REDEMPTION', points: -300, balanceAfter: 200, dedupeKey: `redemption:${order.id}` });
  });

  it('pedido sin canje: idéntico al de siempre (sin descuento ni redención)', async () => {
    await setBalance(500);
    const order = await track(await checkout());
    expect(order.pointsDiscount).toBe(0);
    expect(order.redemption).toBeNull();
    expect(order.total).toBe(order.productsTotal + order.deliveryFee + order.platformFee);
    expect(await balance()).toBe(500);
  });

  it('la cotización coincide con el pedido real y no toca saldo ni crea nada', async () => {
    await setBalance(500);
    const ordersBefore = await prisma.order.count({ where: { customerId } });
    const quote = await customerOrdersService.quoteCheckout(
      {
        businesses: [{ businessId, items: [{ productId: pizzaId, quantity: 1 }, { productId: batidoId, quantity: 1 }] }],
        redemption: { rewardId, expectedBalance: 500 },
      },
      customerId,
    );
    expect(await prisma.order.count({ where: { customerId } })).toBe(ordersBefore);
    expect(await balance()).toBe(500);
    expect(quote.redemption).toMatchObject({ pointsCost: 300, balanceBefore: 500, balanceAfter: 200 });

    const order = await track(await checkout({ redemption: { rewardId } }));
    expect(quote).toMatchObject({
      productsTotal: order.productsTotal,
      pointsDiscount: order.pointsDiscount,
      productsToPay: order.productsTotal - order.pointsDiscount,
      deliveryFee: order.deliveryFee,
      platformFee: order.platformFee,
      total: order.total,
    });
  });

  it('saldo insuficiente (200 < 300): rechaza y no descuenta nada ni crea pedido', async () => {
    await setBalance(200);
    const before = await prisma.order.count({ where: { customerId } });
    await expect(checkout({ redemption: { rewardId } })).rejects.toMatchObject({
      code: 'INSUFFICIENT_POINTS',
      details: { balance: 200, pointsCost: 300, missingPoints: 100 },
    });
    expect(await balance()).toBe(200);
    expect(await prisma.order.count({ where: { customerId } })).toBe(before);
  });

  it('recompensa inactiva: REWARD_INACTIVE, sin descuento', async () => {
    await setBalance(500);
    await prisma.reward.update({ where: { id: rewardId }, data: { active: false } });
    try {
      await expect(checkout({ redemption: { rewardId } })).rejects.toMatchObject({ code: 'REWARD_INACTIVE' });
      expect(await balance()).toBe(500);
    } finally {
      await prisma.reward.update({ where: { id: rewardId }, data: { active: true } });
    }
  });

  it('producto no disponible: se rechaza y no se descuenta nada', async () => {
    await setBalance(500);
    await expect(
      checkout({ redemption: { rewardId: soldOutRewardId } }, [{ productId: soldOutId, quantity: 1 }]),
    ).rejects.toBeInstanceOf(CartChangedError);
    expect(await balance()).toBe(500);
  });

  it('el producto de la recompensa no está en el pedido: REWARD_NOT_ELIGIBLE', async () => {
    await setBalance(500);
    await expect(checkout({ redemption: { rewardId } }, [{ productId: batidoId, quantity: 1 }])).rejects.toMatchObject({
      code: 'REWARD_NOT_ELIGIBLE',
    });
    expect(await balance()).toBe(500);
  });

  it('saldo distinto al que la app tenía en pantalla: POINTS_BALANCE_CHANGED', async () => {
    await setBalance(420);
    await expect(checkout({ redemption: { rewardId, expectedBalance: 500 } })).rejects.toMatchObject({
      code: 'POINTS_BALANCE_CHANGED',
      details: { balance: 420 },
    });
    expect(await balance()).toBe(420);
  });

  it('un invitado no puede canjear', async () => {
    await expect(
      customerOrdersService.createCheckoutOrder(
        {
          customerName: 'Invitado',
          customerPhone: '+5355501234',
          address: 'Calle 9',
          businesses: [{ businessId, items: [{ productId: pizzaId, quantity: 1 }] }],
          redemption: { rewardId },
        } as never,
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'REDEMPTION_REQUIRES_LOGIN' });
  });

  it('doble tap: dos solicitudes SIMULTÁNEAS con el mismo clientRequestId descuentan una sola vez', async () => {
    await setBalance(500);
    const clientRequestId = uniqueRequest('dup');
    const results = await Promise.allSettled([
      checkout({ clientRequestId, redemption: { rewardId } }),
      checkout({ clientRequestId, redemption: { rewardId } }),
    ]);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof checkout>>> => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(fulfilled.map((r) => r.value.id));
    expect(ids.size).toBe(1);
    await track({ id: [...ids][0] as string });

    expect(await balance()).toBe(200);
    expect(await prisma.pointsTransaction.count({ where: { customerId, type: 'REDEMPTION', orderId: [...ids][0] } })).toBe(1);
    expect(await prisma.rewardRedemption.count({ where: { orderId: [...ids][0] } })).toBe(1);
  });

  it('dos dispositivos con 300 puntos canjeando a la vez: solo uno tiene éxito', async () => {
    await setBalance(300);
    const results = await Promise.allSettled([
      checkout({ redemption: { rewardId } }),
      checkout({ redemption: { rewardId } }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]?.reason as RedemptionError).code).toBe('INSUFFICIENT_POINTS');
    for (const r of ok) await track((r as PromiseFulfilledResult<{ id: string }>).value);

    expect(await balance()).toBe(0);
  });

  it('cancelar el pedido devuelve los puntos una sola vez (ledger + estado del canje)', async () => {
    await setBalance(500);
    const order = await track(await checkout({ redemption: { rewardId } }));
    expect(await balance()).toBe(200);

    const cancelled = await ordersService.updateOrderStatus(order.id, { status: 'CANCELLED' });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.redemption?.status).toBe('REFUNDED');
    expect(await balance()).toBe(500);

    const ledger = await prisma.pointsTransaction.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    expect(ledger.map((entry) => [entry.type, entry.points])).toEqual([
      ['REDEMPTION', -300],
      ['REDEMPTION_REFUND', 300],
    ]);
    // Cancelar otra vez no devuelve de nuevo.
    await expect(ordersService.updateOrderStatus(order.id, { status: 'CANCELLED' })).rejects.toBeTruthy();
    expect(await balance()).toBe(500);
  });

  it('puntos por servicio: el pedido canjeado da floor(servicio/10), nada por el producto pagado con puntos', async () => {
    await setBalance(500);
    const order = await track(await checkout({ redemption: { rewardId } }));
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'COMPLETED', completedAt: new Date(Date.now() + 60_000) },
    });
    const balanceBefore = await balance();

    await pointsService.syncOrderPoints(order.id);

    const service = await prisma.pointsTransaction.findFirst({ where: { orderId: order.id, type: 'ORDER_COMPLETED' } });
    expect(service?.points).toBe(Math.floor(order.platformFee / 10));
    expect(Number(service?.serviceFee)).toBe(order.platformFee);
    // Ningún movimiento de puntos por los 300 CUP de la pizza: el canje solo aparece como REDEMPTION.
    const earned = await prisma.pointsTransaction.aggregate({
      where: { orderId: order.id, type: { in: ['ORDER_COMPLETED', 'ORDER_ADJUSTMENT'] } },
      _sum: { points: true },
    });
    expect(earned._sum.points).toBe(Math.floor(order.platformFee / 10));
    // Idempotente: repetir no duplica.
    await pointsService.syncOrderPoints(order.id);
    const bonus = await prisma.pointsTransaction.aggregate({
      where: { orderId: order.id, type: 'FIRST_ORDER_BONUS' },
      _sum: { points: true },
    });
    expect((await balance()) - balanceBefore).toBe(Math.floor(order.platformFee / 10) + (bonus._sum.points ?? 0));
  });

  it('histórico: cambiar Reward.pointsCost o Product.price después no altera un pedido ya canjeado', async () => {
    await setBalance(500);
    const order = await track(await checkout({ redemption: { rewardId } }));

    await prisma.reward.update({ where: { id: rewardId }, data: { pointsCost: 999 } });
    await prisma.product.update({ where: { id: pizzaId }, data: { price: new Prisma.Decimal(777) } });
    try {
      const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { redemption: true, businesses: { include: { items: true } } } });
      expect(Number(stored.pointsDiscount)).toBe(300);
      expect(Number(stored.total)).toBe(order.total);
      expect(stored.redemption).toMatchObject({ pointsCost: 300, rewardName: 'Pizza Especial' });
      expect(Number(stored.redemption?.moneyValue)).toBe(300);
      const line = stored.businesses[0]?.items.find((item) => item.productId === pizzaId);
      expect(Number(line?.unitPrice)).toBe(300);
      expect(line?.pointsRedeemed).toBe(300);
    } finally {
      await prisma.reward.update({ where: { id: rewardId }, data: { pointsCost: 300 } });
      await prisma.product.update({ where: { id: pizzaId }, data: { price: new Prisma.Decimal(300) } });
    }
  });

  it('un pedido canjeado no permite cambiar sus productos desde el dashboard', async () => {
    await setBalance(500);
    const order = await track(await checkout({ redemption: { rewardId } }));
    await expect(
      ordersService.updateOrder(order.id, {
        businesses: [{ businessId, items: [{ productId: batidoId, quantity: 1 }] }],
      } as never),
    ).rejects.toMatchObject({ code: 'ORDER_HAS_REDEMPTION' });
  });

  it('listado de recompensas: excluye las de productos agotados y dice cuánto falta', async () => {
    await setBalance(180);
    const list = await rewardsService.listRewards(customerId);
    expect(list.balance).toBe(180);
    const pizza = list.rewards.find((reward) => reward.id === rewardId);
    expect(pizza).toMatchObject({ status: 'INSUFFICIENT_POINTS', missingPoints: 120, pointsCost: 300, moneyValue: 300 });
    expect(list.rewards.find((reward) => reward.id === soldOutRewardId)).toBeUndefined();

    const guest = await rewardsService.listRewards(undefined);
    expect(guest.balance).toBeNull();
    expect(guest.rewards.find((reward) => reward.id === rewardId)?.status).toBe('LOGIN_REQUIRED');
  });
});

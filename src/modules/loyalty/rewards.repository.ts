import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';
import { orderInclude } from '../orders/orders.repository';
import { RedemptionError, type RedemptionPlan } from './rewards.rules';

const rewardProductSelect = {
  select: {
    id: true,
    name: true,
    active: true,
    available: true,
    businessId: true,
    imageUrl: true,
    price: true,
    business: { select: { id: true, name: true, active: true } },
  },
} satisfies { select: Prisma.ProductSelect };

export const rewardInclude = { product: rewardProductSelect } satisfies Prisma.RewardInclude;

// Las transacciones interactivas de Prisma vencen a los 5 s por defecto; con la base remota y varias
// consultas por transacción eso es poco margen. Se sube a un valor holgado (el trabajo es corto).
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export type RewardWithProduct = Prisma.RewardGetPayload<{ include: typeof rewardInclude }>;

export function findRewardById(id: string) {
  return prisma.reward.findUnique({ where: { id }, include: rewardInclude });
}

/** Recompensas activas cuyo producto sigue en el catálogo (las que tiene sentido enseñar). */
export function listActiveRewards() {
  return prisma.reward.findMany({
    where: { active: true, product: { active: true, available: true, business: { active: true } } },
    include: rewardInclude,
    orderBy: [{ pointsCost: 'asc' }, { name: 'asc' }],
  });
}

export function listAllRewards() {
  return prisma.reward.findMany({ include: rewardInclude, orderBy: [{ active: 'desc' }, { pointsCost: 'asc' }] });
}

export function createReward(data: Prisma.RewardUncheckedCreateInput) {
  return prisma.reward.create({ data, include: rewardInclude });
}

export function updateReward(id: string, data: Prisma.RewardUncheckedUpdateInput) {
  return prisma.reward.update({ where: { id }, data, include: rewardInclude });
}

export async function findCustomerBalance(customerId: string): Promise<number | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { pointsBalance: true },
  });
  return customer ? customer.pointsBalance : null;
}

export function findRedemptionByOrderId(orderId: string) {
  return prisma.rewardRedemption.findUnique({ where: { orderId } });
}

/**
 * Crea el pedido Y aplica el canje en UNA transacción: o pasa todo o no pasa nada.
 *  1. Descuento condicional del saldo (`pointsBalance >= costo`): el UPDATE toma el lock de la
 *     fila del cliente hasta el commit, así dos dispositivos que canjeen a la vez se serializan y
 *     el segundo ve el saldo ya descontado → INSUFFICIENT_POINTS. Nunca queda saldo negativo.
 *  2. Pedido + canje (RewardRedemption con orderId único) + movimiento inmutable en el ledger.
 *  Si algo falla (p. ej. el clientRequestId ya existía: reintento/doble tap), la transacción
 *  entera se revierte, incluido el descuento de puntos.
 */
export function createOrderWithRedemption(params: {
  orderData: Prisma.OrderCreateInput;
  customerId: string;
  plan: RedemptionPlan;
  divisor: number;
}) {
  const { orderData, customerId, plan, divisor } = params;
  return prisma.$transaction(async (tx) => {
    const debited = await tx.customer.updateMany({
      where: { id: customerId, pointsBalance: { gte: plan.pointsCost } },
      data: { pointsBalance: { decrement: plan.pointsCost } },
    });
    if (debited.count === 0) {
      const current = await tx.customer.findUnique({
        where: { id: customerId },
        select: { pointsBalance: true },
      });
      const balance = current?.pointsBalance ?? 0;
      throw new RedemptionError('INSUFFICIENT_POINTS', 'No tienes puntos suficientes para esta recompensa', {
        balance,
        pointsCost: plan.pointsCost,
        missingPoints: Math.max(plan.pointsCost - balance, 0),
      });
    }
    const { pointsBalance: balanceAfter } = await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { pointsBalance: true },
    });

    const order = await tx.order.create({
      data: {
        ...orderData,
        redemption: {
          create: {
            customerId,
            rewardId: plan.rewardId,
            productId: plan.productId,
            rewardName: plan.rewardName,
            pointsCost: plan.pointsCost,
            moneyValue: plan.moneyValue,
          },
        },
      },
      include: orderInclude,
    });

    await tx.pointsTransaction.create({
      data: {
        customerId,
        type: 'REDEMPTION',
        points: -plan.pointsCost,
        balanceAfter,
        orderId: order.id,
        orderNumber: order.orderNumber,
        serviceFee: 0,
        divisor,
        reason: `Canje de ${plan.rewardName} (pedido #${order.orderNumber})`,
        dedupeKey: `redemption:${order.id}`,
      },
    });
    return order;
  }, TX_OPTIONS);
}

/**
 * Devuelve los puntos de un canje aplicado (pedido cancelado o eliminado). Idempotente: el paso
 * APPLIED → REFUNDED solo lo gana una ejecución, y el movimiento tiene dedupeKey único.
 * Devuelve los puntos devueltos, o 0 si no había nada que devolver.
 */
export async function refundRedemptionInTx(tx: Prisma.TransactionClient, orderId: string): Promise<number> {
  const redemption = await tx.rewardRedemption.findUnique({ where: { orderId } });
  if (!redemption || redemption.status !== 'APPLIED') {
    return 0;
  }
  const claimed = await tx.rewardRedemption.updateMany({
    where: { orderId, status: 'APPLIED' },
    data: { status: 'REFUNDED', refundedAt: new Date() },
  });
  if (claimed.count === 0) {
    return 0;
  }

  const customer = await tx.customer.update({
    where: { id: redemption.customerId },
    data: { pointsBalance: { increment: redemption.pointsCost } },
    select: { pointsBalance: true },
  });
  const config = await tx.systemConfig.findUnique({ where: { id: 'singleton' } });
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { orderNumber: true } });
  await tx.pointsTransaction.create({
    data: {
      customerId: redemption.customerId,
      type: 'REDEMPTION_REFUND',
      points: redemption.pointsCost,
      balanceAfter: customer.pointsBalance,
      orderId,
      orderNumber: order?.orderNumber ?? null,
      serviceFee: 0,
      divisor: config?.pointsServiceDivisor ?? 10,
      reason: `Devolución del canje de ${redemption.rewardName}${order ? ` (pedido #${order.orderNumber} cancelado)` : ''}`,
      dedupeKey: `redemption-refund:${orderId}`,
    },
  });
  return redemption.pointsCost;
}

/** Cancela el pedido y devuelve los puntos del canje en la misma transacción. */
export function cancelOrderWithRefund(id: string, data: Prisma.OrderUpdateInput) {
  return prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data });
    await refundRedemptionInTx(tx, id);
    // Se lee DESPUÉS del reembolso para que el pedido devuelto ya diga canje REFUNDED.
    return tx.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
  }, TX_OPTIONS);
}

/** Elimina el pedido devolviendo antes los puntos del canje (el ledger conserva ambos movimientos). */
export function removeOrderWithRefund(id: string) {
  return prisma.$transaction(async (tx) => {
    await refundRedemptionInTx(tx, id);
    return tx.order.delete({ where: { id } });
  }, TX_OPTIONS);
}

import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';
import { POINTS_ELIGIBLE_SOURCES } from './points.rules';

export function findOrderForPoints(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      source: true,
      customerId: true,
      completedAt: true,
      platformFee: true,
    },
  });
}

export interface AppliedMovement {
  /** Movimiento de servicio (crédito inicial o corrección); null si no hubo diferencia. */
  service: {
    type: 'ORDER_COMPLETED' | 'ORDER_ADJUSTMENT';
    points: number;
    /** true = es el primer movimiento de servicio de ese pedido (el crédito inicial). */
    first: boolean;
  } | null;
  /** Puntos de bienvenida acreditados en esta sincronización (0 si no hubo). */
  bonus: number;
  balanceAfter: number;
}

const FIRST_ORDER_BONUS_KEY = (customerId: string) => `first-order-bonus:${customerId}`;

/**
 * Lleva los puntos de ESTE pedido a lo que le corresponde, todo en una transacción:
 *  1. bloquea la fila del cliente (el UPDATE toma el lock hasta el commit), así dos
 *     sincronizaciones simultáneas del mismo cliente se serializan;
 *  2. servicio: suma lo ya registrado para el pedido (créditos y correcciones) y mueve solo la
 *     diferencia con `expected` como UN movimiento inmutable;
 *  3. bono de bienvenida: si el pedido es candidato, el bono no se dio antes y NO existe otro
 *     pedido completado desde la app/web del cliente que sea anterior (por fecha de completado,
 *     desempate por id), se acredita una sola vez. La llave única por cliente lo hace imposible
 *     de duplicar y la regla "el más antiguo" hace que, aunque dos pedidos se completen a la
 *     vez, lo reciba exactamente uno.
 * Devuelve null si no había nada que mover (idempotente: repetirlo no duplica nada).
 */
export function applyOrderPointsDelta(params: {
  orderId: string;
  customerId: string;
  orderNumber: number;
  completedAt: Date | null;
  expected: number;
  /** Bono candidato de este pedido (0 = no aplica). */
  bonusPoints: number;
  serviceFee: Prisma.Decimal;
  divisor: number;
}): Promise<AppliedMovement | null> {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.update({
      where: { id: params.customerId },
      data: { pointsBalance: { increment: 0 } },
      select: { pointsBalance: true },
    });
    let balance = customer.pointsBalance;

    // ── Servicio ────────────────────────────────────────────────────────────
    const recorded = await tx.pointsTransaction.aggregate({
      where: {
        orderId: params.orderId,
        type: { in: ['ORDER_COMPLETED', 'ORDER_ADJUSTMENT'] },
      },
      _sum: { points: true },
      _count: { _all: true },
    });
    const delta = params.expected - (recorded._sum.points ?? 0);
    let service: AppliedMovement['service'] = null;

    if (delta !== 0) {
      const first = recorded._count._all === 0;
      const type = first ? ('ORDER_COMPLETED' as const) : ('ORDER_ADJUSTMENT' as const);
      balance += delta;
      await tx.pointsTransaction.create({
        data: {
          customerId: params.customerId,
          type,
          points: delta,
          balanceAfter: balance,
          orderId: params.orderId,
          orderNumber: params.orderNumber,
          serviceFee: params.serviceFee,
          divisor: params.divisor,
          reason: first
            ? `Pedido #${params.orderNumber} completado`
            : `Corrección de administración en el pedido #${params.orderNumber}`,
          // El crédito inicial lleva una llave única: la base de datos impide duplicarlo.
          dedupeKey: first ? `order-earn:${params.orderId}` : null,
        },
      });
      service = { type, points: delta, first };
    }

    // ── Bono de bienvenida ──────────────────────────────────────────────────
    let bonus = 0;
    if (params.bonusPoints > 0 && params.completedAt) {
      const alreadyGiven = await tx.pointsTransaction.findUnique({
        where: { dedupeKey: FIRST_ORDER_BONUS_KEY(params.customerId) },
        select: { id: true },
      });
      if (!alreadyGiven) {
        const earlierOrders = await tx.order.count({
          where: {
            customerId: params.customerId,
            id: { not: params.orderId },
            source: { in: [...POINTS_ELIGIBLE_SOURCES] },
            status: 'COMPLETED',
            OR: [
              { completedAt: { lt: params.completedAt } },
              { completedAt: params.completedAt, id: { lt: params.orderId } },
            ],
          },
        });
        if (earlierOrders === 0) {
          balance += params.bonusPoints;
          await tx.pointsTransaction.create({
            data: {
              customerId: params.customerId,
              type: 'FIRST_ORDER_BONUS',
              points: params.bonusPoints,
              balanceAfter: balance,
              orderId: params.orderId,
              orderNumber: params.orderNumber,
              serviceFee: params.serviceFee,
              divisor: params.divisor,
              reason: `Bono de bienvenida: tu primer pedido (#${params.orderNumber})`,
              dedupeKey: FIRST_ORDER_BONUS_KEY(params.customerId),
            },
          });
          bonus = params.bonusPoints;
        }
      }
    }

    if (!service && bonus === 0) {
      return null;
    }
    await tx.customer.update({
      where: { id: params.customerId },
      data: { pointsBalance: balance },
    });
    return { service, bonus, balanceAfter: balance };
  });
}

export function findCustomerPoints(customerId: string) {
  return prisma.customer.findUnique({ where: { id: customerId }, select: { pointsBalance: true } });
}

/**
 * ¿Sigue disponible el bono de bienvenida para este cliente? Sí mientras no se le haya dado y no
 * tenga ya un pedido completado desde la app/web (en ese caso ya no es "su primer pedido").
 */
export async function isFirstOrderBonusAvailable(customerId: string): Promise<boolean> {
  const [given, completedOrders] = await Promise.all([
    prisma.pointsTransaction.count({ where: { dedupeKey: FIRST_ORDER_BONUS_KEY(customerId) } }),
    prisma.order.count({
      where: { customerId, source: { in: [...POINTS_ELIGIBLE_SOURCES] }, status: 'COMPLETED' },
    }),
  ]);
  return given === 0 && completedOrders === 0;
}

export function listTransactions(customerId: string, skip: number, take: number) {
  return Promise.all([
    prisma.pointsTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        type: true,
        points: true,
        balanceAfter: true,
        orderNumber: true,
        reason: true,
        createdAt: true,
      },
    }),
    prisma.pointsTransaction.count({ where: { customerId } }),
  ]);
}

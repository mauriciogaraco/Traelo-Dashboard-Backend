import { prisma } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';

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
  type: 'ORDER_COMPLETED' | 'ORDER_ADJUSTMENT';
  points: number;
  balanceAfter: number;
  /** true = es el primer movimiento de ese pedido (el crédito inicial). */
  first: boolean;
}

/**
 * Lleva el saldo de puntos de ESTE pedido a `expected` moviendo solo la diferencia, todo en una
 * transacción:
 *  1. bloquea la fila del cliente (el UPDATE toma el lock hasta el commit), así dos
 *     sincronizaciones simultáneas del mismo cliente se serializan;
 *  2. suma lo ya registrado para el pedido y calcula delta = expected − registrado;
 *  3. si delta ≠ 0, agrega UN movimiento inmutable y actualiza el saldo.
 * Devuelve null si no había nada que mover (idempotente: repetirlo no duplica nada).
 */
export function applyOrderPointsDelta(params: {
  orderId: string;
  customerId: string;
  orderNumber: number;
  expected: number;
  serviceFee: Prisma.Decimal;
  divisor: number;
}): Promise<AppliedMovement | null> {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.update({
      where: { id: params.customerId },
      data: { pointsBalance: { increment: 0 } },
      select: { pointsBalance: true },
    });

    const recorded = await tx.pointsTransaction.aggregate({
      where: { orderId: params.orderId },
      _sum: { points: true },
      _count: { _all: true },
    });
    const delta = params.expected - (recorded._sum.points ?? 0);
    if (delta === 0) {
      return null;
    }

    const first = recorded._count._all === 0;
    const balanceAfter = customer.pointsBalance + delta;
    const type = first ? ('ORDER_COMPLETED' as const) : ('ORDER_ADJUSTMENT' as const);

    await tx.pointsTransaction.create({
      data: {
        customerId: params.customerId,
        type,
        points: delta,
        balanceAfter,
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
    await tx.customer.update({
      where: { id: params.customerId },
      data: { pointsBalance: balanceAfter },
    });

    return { type, points: delta, balanceAfter, first };
  });
}

export function findCustomerPoints(customerId: string) {
  return prisma.customer.findUnique({ where: { id: customerId }, select: { pointsBalance: true } });
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

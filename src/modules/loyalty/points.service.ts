import { getSystemConfig } from '../../config/system-config.service';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import { logger } from '../../shared/logger';
import { sendPushToCustomer } from '../../shared/push/expo-push';
import { NotFoundError } from '../../shared/errors';
import * as repository from './points.repository';
import { buildPointsNotification, expectedPointsForOrder } from './points.rules';

export interface PointsTransactionDTO {
  id: string;
  type: 'ORDER_COMPLETED' | 'ORDER_ADJUSTMENT';
  /** Firmado: positivo acredita, negativo retira. */
  points: number;
  balanceAfter: number;
  orderNumber: number | null;
  reason: string;
  createdAt: Date;
}

export interface CustomerPointsDTO {
  balance: number;
  transactions: PointsTransactionDTO[];
}

export interface PointsMovementResult {
  points: number;
  balanceAfter: number;
  first: boolean;
}

/**
 * Deja los puntos de un pedido en lo que le corresponde HOY (ver expectedPointsForOrder) moviendo
 * solo la diferencia, y avisa al cliente por push. Idempotente: llamarlo dos veces, o desde
 * cualquier ruta (completar, editar, reintentar), nunca duplica ni pierde puntos.
 *
 *  - Pedido recién completado → acredita floor(servicio / divisor).
 *  - Pedido completado y luego corregido → acredita o retira la diferencia como un movimiento
 *    nuevo (ORDER_ADJUSTMENT) y avisa "por corrección de administración".
 *  - Invitado, MANUAL, cancelado, servicio 0 o anterior a pointsEnabledFrom → 0 puntos.
 */
export async function syncOrderPoints(orderId: string): Promise<PointsMovementResult | null> {
  const order = await repository.findOrderForPoints(orderId);
  if (!order || !order.customerId) {
    return null;
  }

  const config = await getSystemConfig();
  const expected = expectedPointsForOrder(order, {
    divisor: config.pointsServiceDivisor,
    enabledFrom: config.pointsEnabledFrom,
  });

  const movement = await repository.applyOrderPointsDelta({
    orderId: order.id,
    customerId: order.customerId,
    orderNumber: order.orderNumber,
    expected,
    serviceFee: order.platformFee,
    divisor: config.pointsServiceDivisor,
  });
  if (!movement) {
    return null;
  }

  // Fuera de la transacción y sin poder fallar: los puntos ya están guardados.
  const notification = buildPointsNotification({
    points: movement.points,
    orderNumber: order.orderNumber,
    first: movement.first,
  });
  await sendPushToCustomer(order.customerId, {
    title: notification.title,
    body: notification.body,
    data: { type: 'points', kind: notification.kind, orderId: order.id, points: movement.points },
  });

  return { points: movement.points, balanceAfter: movement.balanceAfter, first: movement.first };
}

/**
 * Versión para engancharla a completar/editar un pedido: un fallo de puntos NO debe impedir la
 * operación de fondo (el pedido ya cambió). Se registra y, como syncOrderPoints es idempotente,
 * se corrige en la próxima sincronización.
 */
export async function syncOrderPointsSafely(orderId: string): Promise<void> {
  try {
    await syncOrderPoints(orderId);
  } catch (error) {
    logger.error({ err: error, orderId }, 'No se pudieron sincronizar los puntos del pedido');
  }
}

export async function getCustomerPoints(
  customerId: string,
  query: { page: number; pageSize: number },
): Promise<{ data: CustomerPointsDTO; meta: PaginationMeta }> {
  const customer = await repository.findCustomerPoints(customerId);
  if (!customer) {
    throw new NotFoundError('Cliente no encontrado');
  }
  const { skip, take } = toSkipTake(query);
  const [transactions, total] = await repository.listTransactions(customerId, skip, take);
  return {
    data: { balance: customer.pointsBalance, transactions },
    meta: buildPaginationMeta(query, total),
  };
}

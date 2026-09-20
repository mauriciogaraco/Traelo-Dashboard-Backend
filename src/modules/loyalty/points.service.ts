import { getSystemConfig } from '../../config/system-config.service';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import { logger } from '../../shared/logger';
import { sendPushToCustomer } from '../../shared/push/expo-push';
import { NotFoundError } from '../../shared/errors';
import * as repository from './points.repository';
import {
  buildPointsNotification,
  expectedPointsForOrder,
  firstOrderBonusCandidate,
} from './points.rules';

export interface PointsTransactionDTO {
  id: string;
  type:
    | 'ORDER_COMPLETED'
    | 'ORDER_ADJUSTMENT'
    | 'FIRST_ORDER_BONUS'
    | 'REDEMPTION'
    | 'REDEMPTION_REFUND';
  /** Firmado: positivo acredita, negativo retira. */
  points: number;
  balanceAfter: number;
  orderNumber: number | null;
  reason: string;
  createdAt: Date;
}

export interface CustomerPointsDTO {
  balance: number;
  /** Regla vigente: 1 punto por cada `divisor` CUP de Servicio Tráelo (la app la muestra, no la calcula). */
  divisor: number;
  /** Bono de bienvenida: puntos por el primer pedido desde la app y si este cliente todavía puede ganarlo. */
  firstOrderBonus: { points: number; available: boolean };
  transactions: PointsTransactionDTO[];
}

export interface PointsMovementResult {
  /** Movimiento de servicio (0 si no hubo). */
  points: number;
  /** Puntos de bienvenida acreditados (0 si no hubo). */
  bonus: number;
  balanceAfter: number;
  first: boolean;
}

/**
 * Deja los puntos de un pedido en lo que le corresponde HOY (ver expectedPointsForOrder y el bono
 * de primer pedido) moviendo solo la diferencia, y avisa al cliente por push. Idempotente:
 * llamarlo dos veces, o desde cualquier ruta (completar, editar, reintentar), nunca duplica ni
 * pierde puntos.
 *
 *  - Pedido recién completado → acredita floor(servicio / divisor).
 *  - Primer pedido completado del cliente desde la app → además, el bono de bienvenida (una vez).
 *  - Pedido completado y luego corregido → acredita o retira la diferencia de servicio como un
 *    movimiento nuevo (ORDER_ADJUSTMENT) y avisa "por corrección de administración". El bono no
 *    se toca con las correcciones.
 *  - Invitado, MANUAL, cancelado, servicio 0 o anterior a pointsEnabledFrom → 0 puntos de servicio.
 */
export async function syncOrderPoints(orderId: string): Promise<PointsMovementResult | null> {
  const order = await repository.findOrderForPoints(orderId);
  if (!order || !order.customerId) {
    return null;
  }

  const config = await getSystemConfig();
  const rules = {
    divisor: config.pointsServiceDivisor,
    firstOrderBonus: config.pointsFirstOrderBonus,
    enabledFrom: config.pointsEnabledFrom,
  };

  const movement = await repository.applyOrderPointsDelta({
    orderId: order.id,
    customerId: order.customerId,
    orderNumber: order.orderNumber,
    completedAt: order.completedAt,
    expected: expectedPointsForOrder(order, rules),
    bonusPoints: firstOrderBonusCandidate(order, rules),
    serviceFee: order.platformFee,
    divisor: config.pointsServiceDivisor,
  });
  if (!movement) {
    return null;
  }

  const servicePoints = movement.service?.points ?? 0;
  const first = movement.service?.first ?? true;

  // Fuera de la transacción y sin poder fallar: los puntos ya están guardados.
  const notification = buildPointsNotification({
    points: servicePoints,
    bonus: movement.bonus,
    orderNumber: order.orderNumber,
    first,
  });
  await sendPushToCustomer(order.customerId, {
    title: notification.title,
    body: notification.body,
    data: {
      type: 'points',
      kind: notification.kind,
      orderId: order.id,
      points: servicePoints + movement.bonus,
      bonus: movement.bonus,
    },
  });

  return {
    points: servicePoints,
    bonus: movement.bonus,
    balanceAfter: movement.balanceAfter,
    first,
  };
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
  const [[transactions, total], config, bonusAvailable] = await Promise.all([
    repository.listTransactions(customerId, skip, take),
    getSystemConfig(),
    repository.isFirstOrderBonusAvailable(customerId),
  ]);
  return {
    data: {
      balance: customer.pointsBalance,
      divisor: config.pointsServiceDivisor,
      firstOrderBonus: {
        points: config.pointsFirstOrderBonus,
        available: bonusAvailable && config.pointsFirstOrderBonus > 0,
      },
      transactions,
    },
    meta: buildPaginationMeta(query, total),
  };
}

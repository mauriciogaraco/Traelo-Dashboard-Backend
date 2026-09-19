import { Prisma } from '../../generated/prisma/client';
import type { OrderSource, OrderStatus } from '../../generated/prisma/enums';

// Reglas de la V1 de puntos, todas puras (sin base de datos) para poder probarlas a fondo.
//
//  - puntos = floor(Servicio Tráelo / divisor), SIEMPRE entero. Solo sobre el Servicio Tráelo
//    realmente cobrado (Order.platformFee): nunca sobre productos, delivery, propina ni total.
//  - Solo se acreditan cuando el pedido está COMPLETED (nunca al crearlo; cancelado = sin puntos).
//  - Solo pedidos de cliente con cuenta (customerId). Invitados → sin puntos.
//  - Los pedidos que el staff carga a mano en el dashboard (MANUAL) no dan puntos.

/** Orígenes de pedido que generan puntos: los que el cliente hizo desde la app/web. */
export const POINTS_ELIGIBLE_SOURCES: readonly OrderSource[] = ['APP', 'WEB'];

export const DEFAULT_POINTS_DIVISOR = 10;

export function calculatePoints(
  serviceFee: Prisma.Decimal | number | string,
  divisor: number = DEFAULT_POINTS_DIVISOR,
): number {
  if (!Number.isInteger(divisor) || divisor < 1) {
    throw new RangeError('El divisor de puntos debe ser un entero positivo');
  }
  const fee = new Prisma.Decimal(serviceFee);
  if (fee.lte(0)) {
    return 0;
  }
  return fee.div(divisor).floor().toNumber();
}

export interface PointsOrderFacts {
  status: OrderStatus;
  source: OrderSource;
  customerId: string | null;
  completedAt: Date | null;
  platformFee: Prisma.Decimal | number | string;
}

export interface PointsRuleConfig {
  divisor: number;
  /** Solo cuentan los pedidos completados desde esta fecha (no hay puntos retroactivos). */
  enabledFrom: Date;
}

export function isOrderEligibleForPoints(
  order: PointsOrderFacts,
  config: PointsRuleConfig,
): boolean {
  return (
    order.status === 'COMPLETED' &&
    order.customerId !== null &&
    POINTS_ELIGIBLE_SOURCES.includes(order.source) &&
    order.completedAt !== null &&
    order.completedAt >= config.enabledFrom
  );
}

/**
 * Los puntos que ESTE pedido debería tener hoy. Es la única fuente de verdad: acreditar,
 * corregir y reintentar comparan esta cifra con lo ya registrado y mueven solo la diferencia.
 */
export function expectedPointsForOrder(order: PointsOrderFacts, config: PointsRuleConfig): number {
  return isOrderEligibleForPoints(order, config)
    ? calculatePoints(order.platformFee, config.divisor)
    : 0;
}

export type PointsMovementKind = 'EARNED' | 'ADDED' | 'REMOVED';

export interface PointsNotification {
  title: string;
  body: string;
}

const pointsLabel = (points: number) => `${points} ${points === 1 ? 'punto' : 'puntos'}`;

/** Texto del aviso al cliente. `first` = es el crédito inicial del pedido; si no, es una corrección. */
export function buildPointsNotification(params: {
  points: number;
  orderNumber: number;
  first: boolean;
}): PointsNotification & { kind: PointsMovementKind } {
  const { points, orderNumber, first } = params;
  const amount = pointsLabel(Math.abs(points));

  if (first) {
    return {
      kind: 'EARNED',
      title: '¡Ganaste puntos!',
      body: `Recibiste ${amount} por tu pedido #${orderNumber}.`,
    };
  }
  if (points > 0) {
    return {
      kind: 'ADDED',
      title: 'Ajuste de puntos',
      body: `Recibiste ${amount} adicionales por una corrección de administración en tu pedido #${orderNumber}.`,
    };
  }
  return {
    kind: 'REMOVED',
    title: 'Ajuste de puntos',
    body: `Se retiraron ${amount} de tu pedido #${orderNumber} por una corrección de administración: se acreditaron por error.`,
  };
}

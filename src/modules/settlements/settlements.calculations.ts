import { Prisma } from '../../generated/prisma/client';

export type Money = InstanceType<typeof Prisma.Decimal>;

export interface OrderForSettlement {
  id: string;
  deliveryFee: Money;
  delivererEarning: Money;
  traeloDeliveryShare: Money;
  platformFee: Money;
}

export interface SettlementTotals {
  totalDeliveries: number;
  totalCollected: Money;
  traeloDeliveryShare: Money;
  delivererShare: Money;
  platformFeeCollected: Money;
  totalToDeliver: Money;
}

/**
 * Deriva los totales del cuadre a partir de los campos ya calculados y guardados en cada
 * pedido (deliveryFee, delivererEarning, traeloDeliveryShare, platformFee) — sin volver a
 * derivar por resta: el Servicio Tráelo (platformFee) y la parte de Tráelo en la mensajería
 * (traeloDeliveryShare) ya están guardados explícitos en el pedido.
 */
export function computeSettlementTotals(orders: OrderForSettlement[]): SettlementTotals {
  let totalCollected = new Prisma.Decimal(0);
  let delivererShare = new Prisma.Decimal(0);
  let traeloDeliveryShare = new Prisma.Decimal(0);
  let platformFeeCollected = new Prisma.Decimal(0);

  for (const order of orders) {
    totalCollected = totalCollected.plus(order.deliveryFee);
    delivererShare = delivererShare.plus(order.delivererEarning);
    traeloDeliveryShare = traeloDeliveryShare.plus(order.traeloDeliveryShare);
    platformFeeCollected = platformFeeCollected.plus(order.platformFee);
  }

  const totalToDeliver = traeloDeliveryShare.plus(platformFeeCollected);

  return {
    totalDeliveries: orders.length,
    totalCollected,
    traeloDeliveryShare,
    delivererShare,
    platformFeeCollected,
    totalToDeliver,
  };
}

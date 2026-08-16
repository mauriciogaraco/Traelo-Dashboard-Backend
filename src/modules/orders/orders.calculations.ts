import { Prisma } from '../../generated/prisma/client';

export type Money = InstanceType<typeof Prisma.Decimal>;

export interface ItemInput {
  productId?: string;
  productName?: string;
  quantity: number;
  unitPrice: number;
}

export interface ComputedItemPrice {
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: Money;
  subtotal: Money;
}

/**
 * Precio y subtotal de una línea. El unitPrice viene tal cual del negocio/empleado — nunca se
 * infla acá ni en ningún otro lugar del backend; la ganancia de Tráelo es platformFee, aparte.
 */
export function computeItem(input: ItemInput, productName: string): ComputedItemPrice {
  const unitPrice = new Prisma.Decimal(input.unitPrice);
  const subtotal = unitPrice.mul(input.quantity);

  return {
    productId: input.productId ?? null,
    productName,
    quantity: input.quantity,
    unitPrice,
    subtotal,
  };
}

/** Redondea siempre hacia arriba al múltiplo de 10 más cercano. Único lugar de esta regla. */
export function roundUpToNearest10(amount: Money): Money {
  return amount.div(10).ceil().mul(10);
}

export interface OrderTotalsInput {
  subtotal: Money; // suma de subtotales de negocios (productsTotal)
  rawCommissionSum: Money; // suma de comisiones por negocio, SIN redondear
  deliveryFee: Money;
}

export interface OrderTotals {
  productsTotal: Money;
  platformFee: Money; // "Servicio Tráelo": rawCommissionSum redondeado hacia arriba, una sola vez
  total: Money; // productsTotal + deliveryFee + platformFee
}

export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const platformFee = roundUpToNearest10(input.rawCommissionSum);
  const total = input.subtotal.plus(input.deliveryFee).plus(platformFee);

  return { productsTotal: input.subtotal, platformFee, total };
}

export function computeDeliverySplit(
  deliveryFee: Money,
  delivererPercentage: number,
): { delivererShare: Money; traeloDeliveryShare: Money } {
  const delivererShare = deliveryFee.mul(delivererPercentage).div(100);
  const traeloDeliveryShare = deliveryFee.minus(delivererShare);
  return { delivererShare, traeloDeliveryShare };
}

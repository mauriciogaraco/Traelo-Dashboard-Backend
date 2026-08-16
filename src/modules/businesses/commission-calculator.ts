import { Prisma } from '../../generated/prisma/client';
import type { CommissionType } from '../../generated/prisma/enums';

export type Money = InstanceType<typeof Prisma.Decimal>;

export interface CommissionBusinessInput {
  commissionType: CommissionType;
  commissionPercentage: Money | null;
  defaultProductCommissionAmount: Money | null;
}

export interface CommissionProductInput {
  commission: { commissionAmount: Money } | null;
}

export interface CommissionGroupResult {
  commissionEarned: Money; // total del negocio en este pedido, SIN redondear (detalle exacto)
  commissionTypeSnapshot: CommissionType;
  commissionRateSnapshot: Money | null; // % aplicado, solo cuando commissionType = PERCENTAGE
}

/**
 * Único lugar que sabe calcular comisión por negocio. Aislado de Orders para que sumar un
 * modelo nuevo (p.ej. FIXED_PRODUCT_MARGIN, CUSTOM_PRODUCT_MARGIN) sea un cambio local acá,
 * sin ramificar condicionales por el resto del dominio de pedidos.
 */

/** Comisión de una línea individual. Solo aporta en modelos por-producto (FIXED_PER_PRODUCT). */
export function computeLineCommission(
  business: CommissionBusinessInput,
  product: CommissionProductInput | null,
  quantity: number,
): Money {
  if (business.commissionType !== 'FIXED_PER_PRODUCT') {
    return new Prisma.Decimal(0);
  }
  const perUnit =
    product?.commission?.commissionAmount ??
    business.defaultProductCommissionAmount ??
    new Prisma.Decimal(0);
  return new Prisma.Decimal(perUnit).mul(quantity);
}

/**
 * Comisión total de un negocio dentro de un pedido, junto con el snapshot de qué modelo/tasa
 * se usó (para que si el negocio cambia su configuración después, el pedido no se altere).
 */
export function computeGroupCommission(
  business: CommissionBusinessInput,
  subtotal: Money,
  lineCommissions: Money[],
): CommissionGroupResult {
  if (business.commissionType === 'PERCENTAGE') {
    const rate = business.commissionPercentage ?? new Prisma.Decimal(0);
    return {
      commissionEarned: subtotal.mul(rate).div(100),
      commissionTypeSnapshot: 'PERCENTAGE',
      commissionRateSnapshot: rate,
    };
  }

  return {
    commissionEarned: lineCommissions.reduce((acc, c) => acc.plus(c), new Prisma.Decimal(0)),
    commissionTypeSnapshot: 'FIXED_PER_PRODUCT',
    commissionRateSnapshot: null,
  };
}

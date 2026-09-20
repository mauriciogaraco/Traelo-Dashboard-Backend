import { AppError } from '../../shared/errors';

// Reglas del canje de puntos V1, puras (sin base de datos) para poder probarlas a fondo.
//
//  - El cliente solo pide "quiero aplicar esta recompensa" (rewardId). TODO lo demás (costo,
//    precio, elegibilidad, saldo, descuento, total) lo decide el servidor.
//  - Una recompensa cubre UNA unidad de su producto; una recompensa por pedido.
//  - Los puntos solo cubren el producto: nunca mensajería, Servicio Tráelo ni otros cargos.
//  - No existe equivalencia fija puntos↔CUP: el costo es Reward.pointsCost.

export type RedemptionErrorCode =
  | 'REWARD_NOT_FOUND'
  | 'REWARD_INACTIVE'
  | 'REWARD_UNAVAILABLE'
  | 'REWARD_NOT_ELIGIBLE'
  | 'INSUFFICIENT_POINTS'
  | 'POINTS_BALANCE_CHANGED'
  | 'REDEMPTION_ALREADY_APPLIED'
  | 'REDEMPTION_REQUIRES_LOGIN';

const STATUS_BY_CODE: Record<RedemptionErrorCode, number> = {
  REWARD_NOT_FOUND: 404,
  REWARD_INACTIVE: 409,
  REWARD_UNAVAILABLE: 409,
  REWARD_NOT_ELIGIBLE: 409,
  INSUFFICIENT_POINTS: 409,
  POINTS_BALANCE_CHANGED: 409,
  REDEMPTION_ALREADY_APPLIED: 409,
  REDEMPTION_REQUIRES_LOGIN: 400,
};

/** Error estructurado del canje: `code` machine-readable + `details` para que la app explique qué pasó. */
export class RedemptionError extends AppError {
  constructor(code: RedemptionErrorCode, message: string, details?: unknown) {
    super(message, STATUS_BY_CODE[code], code, details);
  }
}

export interface RewardFacts {
  id: string;
  name: string;
  pointsCost: number;
  active: boolean;
  productId: string;
  /** El producto existe, está activo y disponible (no agotado) y su negocio está activo. */
  productAvailable: boolean;
}

/** Una línea del carrito YA resuelta por el servidor (precio efectivo vigente, no el de la app). */
export interface CartLineFacts {
  productId: string;
  businessId: string;
  unitPrice: number;
}

export interface RedemptionPlan {
  rewardId: string;
  rewardName: string;
  pointsCost: number;
  productId: string;
  businessId: string;
  /** Valor en CUP de UNA unidad del producto: es lo que deja de pagar el cliente. */
  moneyValue: number;
  balanceBefore: number;
  balanceAfter: number;
}

export interface PlanRedemptionInput {
  reward: RewardFacts;
  lines: CartLineFacts[];
  balance: number;
  /** Saldo que la app tenía en pantalla al confirmar. Solo detecta datos viejos; nunca se usa para calcular. */
  expectedBalance?: number;
}

/**
 * Decide si el canje es válido y, si lo es, devuelve el plan (qué línea se cubre, cuánto vale y
 * cómo queda el saldo). Lanza RedemptionError con el código exacto si no.
 */
export function planRedemption(input: PlanRedemptionInput): RedemptionPlan {
  const { reward, lines, balance, expectedBalance } = input;

  if (!reward.active) {
    throw new RedemptionError('REWARD_INACTIVE', 'Esta recompensa ya no está activa');
  }
  if (!reward.productAvailable) {
    throw new RedemptionError('REWARD_UNAVAILABLE', `${reward.name} no está disponible ahora mismo`);
  }

  const line = lines.find((entry) => entry.productId === reward.productId);
  if (!line) {
    throw new RedemptionError(
      'REWARD_NOT_ELIGIBLE',
      `Agrega ${reward.name} a tu pedido para poder canjearlo`,
    );
  }

  if (expectedBalance !== undefined && expectedBalance !== balance) {
    throw new RedemptionError(
      'POINTS_BALANCE_CHANGED',
      'Tus puntos han cambiado. Actualizamos la información. Revisa nuevamente antes de confirmar.',
      { balance },
    );
  }
  if (balance < reward.pointsCost) {
    throw new RedemptionError('INSUFFICIENT_POINTS', 'No tienes puntos suficientes para esta recompensa', {
      balance,
      pointsCost: reward.pointsCost,
      missingPoints: reward.pointsCost - balance,
    });
  }

  return {
    rewardId: reward.id,
    rewardName: reward.name,
    pointsCost: reward.pointsCost,
    productId: line.productId,
    businessId: line.businessId,
    moneyValue: line.unitPrice,
    balanceBefore: balance,
    balanceAfter: balance - reward.pointsCost,
  };
}

export type RewardListStatus = 'AVAILABLE' | 'INSUFFICIENT_POINTS' | 'LOGIN_REQUIRED';

/** Estado de una recompensa en el listado, según el saldo (null = invitado). */
export function rewardListStatus(
  pointsCost: number,
  balance: number | null,
): { status: RewardListStatus; missingPoints: number } {
  if (balance === null) {
    return { status: 'LOGIN_REQUIRED', missingPoints: pointsCost };
  }
  return balance >= pointsCost
    ? { status: 'AVAILABLE', missingPoints: 0 }
    : { status: 'INSUFFICIENT_POINTS', missingPoints: pointsCost - balance };
}

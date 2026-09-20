import { describe, expect, it } from 'vitest';
import { checkoutOrderSchema, checkoutQuoteSchema } from '../checkout/checkout.dto';
import {
  planRedemption,
  RedemptionError,
  rewardListStatus,
  type PlanRedemptionInput,
} from './rewards.rules';

const PIZZA = 'cmu0000000000000000pizza0';
const BATIDO = 'cmu0000000000000batido00';
const BUSINESS = 'cmu000000000000business000';

function input(overrides: Partial<PlanRedemptionInput> = {}): PlanRedemptionInput {
  return {
    reward: {
      id: 'reward-1',
      name: 'Pizza Especial',
      pointsCost: 300,
      active: true,
      productId: PIZZA,
      productAvailable: true,
    },
    lines: [
      { productId: PIZZA, businessId: BUSINESS, unitPrice: 300 },
      { productId: BATIDO, businessId: BUSINESS, unitPrice: 150 },
    ],
    balance: 500,
    ...overrides,
  };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof RedemptionError ? error.code : `OTRO:${String(error)}`;
  }
  return undefined;
}

describe('planRedemption', () => {
  it('cliente con 500 puntos y recompensa de 300: éxito y saldo final de 200', () => {
    const plan = planRedemption(input());
    expect(plan).toMatchObject({
      rewardId: 'reward-1',
      pointsCost: 300,
      productId: PIZZA,
      moneyValue: 300,
      balanceBefore: 500,
      balanceAfter: 200,
    });
  });

  it('el valor en CUP sale del precio vigente de la línea, no del costo en puntos (1 punto ≠ 1 CUP)', () => {
    const plan = planRedemption(
      input({
        reward: { ...input().reward, pointsCost: 800 },
        lines: [{ productId: PIZZA, businessId: BUSINESS, unitPrice: 700 }],
        balance: 1000,
      }),
    );
    expect(plan.pointsCost).toBe(800);
    expect(plan.moneyValue).toBe(700);
    expect(plan.balanceAfter).toBe(200);
  });

  it('con varias unidades del producto solo cubre UNA unidad', () => {
    const plan = planRedemption(
      input({ lines: [{ productId: PIZZA, businessId: BUSINESS, unitPrice: 300 }] }),
    );
    expect(plan.moneyValue).toBe(300);
  });

  it('saldo insuficiente (200 < 300): rechaza con INSUFFICIENT_POINTS y cuánto falta', () => {
    try {
      planRedemption(input({ balance: 200 }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RedemptionError);
      const e = error as RedemptionError;
      expect(e.code).toBe('INSUFFICIENT_POINTS');
      expect(e.statusCode).toBe(409);
      expect(e.details).toEqual({ balance: 200, pointsCost: 300, missingPoints: 100 });
    }
  });

  it('saldo justo (300 = 300) alcanza y queda en 0', () => {
    expect(planRedemption(input({ balance: 300 })).balanceAfter).toBe(0);
  });

  it('recompensa inactiva: REWARD_INACTIVE', () => {
    expect(codeOf(() => planRedemption(input({ reward: { ...input().reward, active: false } })))).toBe(
      'REWARD_INACTIVE',
    );
  });

  it('producto no disponible (agotado o negocio inactivo): REWARD_UNAVAILABLE', () => {
    expect(
      codeOf(() => planRedemption(input({ reward: { ...input().reward, productAvailable: false } }))),
    ).toBe('REWARD_UNAVAILABLE');
  });

  it('el producto de la recompensa no está en el pedido: REWARD_NOT_ELIGIBLE', () => {
    expect(
      codeOf(() =>
        planRedemption(input({ lines: [{ productId: BATIDO, businessId: BUSINESS, unitPrice: 150 }] })),
      ),
    ).toBe('REWARD_NOT_ELIGIBLE');
  });

  it('si el saldo real difiere del que la app tenía en pantalla: POINTS_BALANCE_CHANGED (con el saldo real)', () => {
    try {
      planRedemption(input({ balance: 420, expectedBalance: 500 }));
      expect.unreachable();
    } catch (error) {
      const e = error as RedemptionError;
      expect(e.code).toBe('POINTS_BALANCE_CHANGED');
      expect(e.details).toEqual({ balance: 420 });
      expect(e.message).toMatch(/Tus puntos han cambiado/);
    }
  });

  it('expectedBalance igual al real no estorba, y nunca se usa para calcular', () => {
    const plan = planRedemption(input({ balance: 420, expectedBalance: 420 }));
    expect(plan.balanceBefore).toBe(420);
    expect(plan.balanceAfter).toBe(120);
  });
});

describe('RedemptionError', () => {
  it('cada código tiene su estado HTTP', () => {
    expect(new RedemptionError('REWARD_NOT_FOUND', 'x').statusCode).toBe(404);
    expect(new RedemptionError('REDEMPTION_REQUIRES_LOGIN', 'x').statusCode).toBe(400);
    expect(new RedemptionError('REDEMPTION_ALREADY_APPLIED', 'x').statusCode).toBe(409);
  });
});

describe('rewardListStatus', () => {
  it('invitado: LOGIN_REQUIRED', () => {
    expect(rewardListStatus(300, null)).toEqual({ status: 'LOGIN_REQUIRED', missingPoints: 300 });
  });
  it('con saldo suficiente: AVAILABLE', () => {
    expect(rewardListStatus(300, 420)).toEqual({ status: 'AVAILABLE', missingPoints: 0 });
  });
  it('sin saldo suficiente: cuánto falta (180 puntos → faltan 120)', () => {
    expect(rewardListStatus(300, 180)).toEqual({ status: 'INSUFFICIENT_POINTS', missingPoints: 120 });
  });
});

describe('DTO de checkout: el cliente NUNCA fija costo, descuento ni totales', () => {
  const base = {
    address: 'Calle 1 #2',
    businesses: [{ businessId: BUSINESS, items: [{ productId: PIZZA, quantity: 1 }] }],
  };

  it('descarta pointsCost, discount y subtotalAfterDiscount aunque los envíe', () => {
    const parsed = checkoutOrderSchema.parse({
      ...base,
      redemption: {
        rewardId: BATIDO,
        expectedBalance: 420,
        pointsCost: 1,
        discount: 9999,
        subtotalAfterDiscount: 0,
      },
      pointsDiscount: 9999,
      total: 1,
    });
    expect(parsed.redemption).toEqual({ rewardId: BATIDO, expectedBalance: 420 });
    expect(parsed).not.toHaveProperty('pointsDiscount');
    expect(parsed).not.toHaveProperty('total');
  });

  it('sin redemption el body sigue siendo válido (pedido normal)', () => {
    expect(checkoutOrderSchema.parse(base).redemption).toBeUndefined();
  });

  it('la cotización solo pide carrito + canje opcional (sin dirección)', () => {
    const parsed = checkoutQuoteSchema.parse({
      businesses: base.businesses,
      redemption: { rewardId: PIZZA },
    });
    expect(parsed.redemption?.rewardId).toBe(PIZZA);
  });

  it('rechaza un rewardId que no es un id', () => {
    expect(checkoutQuoteSchema.safeParse({ businesses: base.businesses, redemption: { rewardId: 'x' } }).success).toBe(
      false,
    );
  });
});

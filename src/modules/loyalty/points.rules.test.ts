import { describe, expect, it } from 'vitest';
import {
  buildPointsNotification,
  calculatePoints,
  expectedPointsForOrder,
  firstOrderBonusCandidate,
  isOrderEligibleForPoints,
  type PointsOrderFacts,
  type PointsRuleConfig,
} from './points.rules';

const config: PointsRuleConfig = {
  divisor: 10,
  firstOrderBonus: 10,
  enabledFrom: new Date('2026-09-19T00:00:00Z'),
};

const order = (overrides: Partial<PointsOrderFacts> = {}): PointsOrderFacts => ({
  status: 'COMPLETED',
  source: 'APP',
  customerId: 'c1',
  completedAt: new Date('2026-09-20T12:00:00Z'),
  platformFee: 50,
  ...overrides,
});

describe('calculatePoints — floor(servicio / 10), siempre entero', () => {
  it.each([
    [20, 2],
    [50, 5],
    [100, 10],
    [200, 20],
    [1000, 100],
    [25, 2],
    [29, 2],
    [30, 3],
    [49, 4],
    [9, 0],
    [0, 0],
  ])('servicio %s CUP → %s puntos', (fee, points) => {
    expect(calculatePoints(fee)).toBe(points);
  });

  it('siempre devuelve un entero, aunque el servicio traiga decimales', () => {
    for (const fee of [29.99, 30.01, 99.99, 10.5, '45.50', 0.99]) {
      expect(Number.isInteger(calculatePoints(fee))).toBe(true);
    }
    expect(calculatePoints(29.99)).toBe(2);
    expect(calculatePoints('45.50')).toBe(4);
  });

  it('un servicio negativo o cero no da puntos', () => {
    expect(calculatePoints(-50)).toBe(0);
    expect(calculatePoints(0)).toBe(0);
  });

  it('el divisor es configurable', () => {
    expect(calculatePoints(100, 5)).toBe(20);
    expect(calculatePoints(100, 20)).toBe(5);
    expect(calculatePoints(99, 20)).toBe(4);
  });

  it('un divisor inválido (0, negativo o decimal) se rechaza en vez de dar resultados absurdos', () => {
    expect(() => calculatePoints(50, 0)).toThrow(RangeError);
    expect(() => calculatePoints(50, -10)).toThrow(RangeError);
    expect(() => calculatePoints(50, 2.5)).toThrow(RangeError);
  });
});

describe('elegibilidad para puntos', () => {
  it('pedido completado de un cliente con cuenta, hecho desde la app o la web → sí', () => {
    expect(isOrderEligibleForPoints(order(), config)).toBe(true);
    expect(isOrderEligibleForPoints(order({ source: 'WEB' }), config)).toBe(true);
  });

  it('cliente sin registrar (invitado, customerId null) → sin puntos', () => {
    expect(expectedPointsForOrder(order({ customerId: null }), config)).toBe(0);
  });

  it('pedido cargado a mano desde el dashboard (MANUAL) → sin puntos, aunque tenga cliente', () => {
    expect(expectedPointsForOrder(order({ source: 'MANUAL' }), config)).toBe(0);
  });

  it('pedidos de origen Telegram → sin puntos', () => {
    expect(expectedPointsForOrder(order({ source: 'TELEGRAM' }), config)).toBe(0);
  });

  it.each(['PENDING', 'ASSIGNED', 'CANCELLED'] as const)(
    'un pedido %s NO da puntos: solo se acreditan al completarse',
    (status) => {
      expect(expectedPointsForOrder(order({ status, completedAt: null }), config)).toBe(0);
    },
  );

  it('servicio en 0 → sin puntos', () => {
    expect(expectedPointsForOrder(order({ platformFee: 0 }), config)).toBe(0);
  });

  it('servicio menor al divisor (p. ej. 9 CUP) → 0 puntos', () => {
    expect(expectedPointsForOrder(order({ platformFee: 9 }), config)).toBe(0);
  });

  it('completado antes de que se activara el sistema → sin puntos retroactivos', () => {
    expect(
      expectedPointsForOrder(order({ completedAt: new Date('2026-09-18T23:59:59Z') }), config),
    ).toBe(0);
  });

  it('completado sin fecha de completado → sin puntos', () => {
    expect(expectedPointsForOrder(order({ completedAt: null }), config)).toBe(0);
  });

  it('se calcula SOLO sobre el Servicio Tráelo: el resto del pedido no entra en la cuenta', () => {
    // PointsOrderFacts ni siquiera recibe subtotal, delivery ni total: no puede usarlos.
    expect(Object.keys(order())).not.toEqual(
      expect.arrayContaining(['total', 'productsTotal', 'deliveryFee']),
    );
    expect(expectedPointsForOrder(order({ platformFee: 50 }), config)).toBe(5);
  });
});

describe('avisos al cliente', () => {
  it('crédito inicial', () => {
    expect(buildPointsNotification({ points: 5, orderNumber: 1234, first: true })).toEqual({
      kind: 'EARNED',
      title: '¡Ganaste puntos!',
      body: 'Recibiste 5 puntos por tu pedido #1234.',
    });
  });

  it('singular cuando es un solo punto', () => {
    expect(buildPointsNotification({ points: 1, orderNumber: 7, first: true }).body).toBe(
      'Recibiste 1 punto por tu pedido #7.',
    );
  });

  it('corrección a favor: indica que viene de administración', () => {
    const notification = buildPointsNotification({ points: 3, orderNumber: 88, first: false });
    expect(notification.kind).toBe('ADDED');
    expect(notification.body).toBe(
      'Recibiste 3 puntos adicionales por una corrección de administración en tu pedido #88.',
    );
  });

  it('corrección en contra: explica que se retiran por un error corregido', () => {
    const notification = buildPointsNotification({ points: -4, orderNumber: 88, first: false });
    expect(notification.kind).toBe('REMOVED');
    expect(notification.body).toBe(
      'Se retiraron 4 puntos de tu pedido #88 por una corrección de administración: se acreditaron por error.',
    );
  });
});

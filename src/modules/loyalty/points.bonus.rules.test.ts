import { describe, expect, it } from 'vitest';
import {
  buildPointsNotification,
  firstOrderBonusCandidate,
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

describe('bono de bienvenida: candidato', () => {
  it('un pedido completado con cuenta desde la app es candidato a los 10 puntos', () => {
    expect(firstOrderBonusCandidate(order(), config)).toBe(10);
    expect(firstOrderBonusCandidate(order({ source: 'WEB' }), config)).toBe(10);
  });

  it('es independiente del Servicio Tráelo: también con servicio 0', () => {
    expect(firstOrderBonusCandidate(order({ platformFee: 0 }), config)).toBe(10);
  });

  it('no es candidato: invitado, manual, telegram, sin completar o anterior a la activación', () => {
    expect(firstOrderBonusCandidate(order({ customerId: null }), config)).toBe(0);
    expect(firstOrderBonusCandidate(order({ source: 'MANUAL' }), config)).toBe(0);
    expect(firstOrderBonusCandidate(order({ source: 'TELEGRAM' }), config)).toBe(0);
    expect(firstOrderBonusCandidate(order({ status: 'ASSIGNED', completedAt: null }), config)).toBe(
      0,
    );
    expect(
      firstOrderBonusCandidate(order({ status: 'CANCELLED', completedAt: null }), config),
    ).toBe(0);
    expect(
      firstOrderBonusCandidate(order({ completedAt: new Date('2026-09-18T00:00:00Z') }), config),
    ).toBe(0);
  });

  it('el monto es configurable y 0 lo desactiva', () => {
    expect(firstOrderBonusCandidate(order(), { ...config, firstOrderBonus: 25 })).toBe(25);
    expect(firstOrderBonusCandidate(order(), { ...config, firstOrderBonus: 0 })).toBe(0);
  });
});

describe('bono de bienvenida: avisos', () => {
  it('servicio + bono en un solo aviso', () => {
    expect(buildPointsNotification({ points: 5, bonus: 10, orderNumber: 12, first: true })).toEqual(
      {
        kind: 'EARNED',
        title: '¡Ganaste puntos!',
        body: 'Recibiste 5 puntos por tu pedido #12 y 10 puntos de bienvenida por tu primer pedido.',
      },
    );
  });

  it('solo bono cuando el servicio no dio puntos', () => {
    expect(buildPointsNotification({ points: 0, bonus: 10, orderNumber: 12, first: true })).toEqual(
      {
        kind: 'EARNED',
        title: '¡Puntos de bienvenida!',
        body: 'Recibiste 10 puntos de bienvenida por tu primer pedido #12.',
      },
    );
  });

  it('sin bono el texto no cambia', () => {
    expect(
      buildPointsNotification({ points: 5, bonus: 0, orderNumber: 12, first: true }).body,
    ).toBe('Recibiste 5 puntos por tu pedido #12.');
  });
});

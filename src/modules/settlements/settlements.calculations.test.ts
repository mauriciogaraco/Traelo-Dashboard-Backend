import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { computeSettlementTotals, type OrderForSettlement } from './settlements.calculations';

const d = (value: number) => new Prisma.Decimal(value);

function order(overrides: Partial<OrderForSettlement> = {}): OrderForSettlement {
  return {
    id: 'o1',
    deliveryFee: d(100),
    delivererEarning: d(60),
    traeloDeliveryShare: d(40),
    platformFee: d(10),
    ...overrides,
  };
}

describe('computeSettlementTotals', () => {
  it('pedido normal: el mensajero entrega la parte de Tráelo en la mensajería + el Servicio Tráelo', () => {
    const totals = computeSettlementTotals([order()]);
    expect(totals.totalToDeliver.toNumber()).toBe(50);
  });

  it('pedido con canje de puntos: baja lo que entrega el mensajero (cobró menos y aun así pagó al negocio completo)', () => {
    // Pizza 300 pagada con puntos: el cliente pagó 300 menos, Tráelo lo absorbe.
    const totals = computeSettlementTotals([order({ pointsDiscount: d(300) })]);
    expect(totals.totalToDeliver.toNumber()).toBe(50 - 300);
    // El resto de totales no cambia: mensajería y Servicio Tráelo permanecen.
    expect(totals.platformFeeCollected.toNumber()).toBe(10);
    expect(totals.traeloDeliveryShare.toNumber()).toBe(40);
    expect(totals.delivererShare.toNumber()).toBe(60);
  });

  it('pointsDiscount en 0 o ausente deja el cuadre idéntico al de siempre', () => {
    const plain = computeSettlementTotals([order()]);
    const zero = computeSettlementTotals([order({ pointsDiscount: d(0) })]);
    expect(zero.totalToDeliver.toNumber()).toBe(plain.totalToDeliver.toNumber());
  });

  it('mezcla de pedidos con y sin canje', () => {
    const totals = computeSettlementTotals([order({ id: 'a' }), order({ id: 'b', pointsDiscount: d(150) })]);
    expect(totals.totalDeliveries).toBe(2);
    expect(totals.totalToDeliver.toNumber()).toBe(100 - 150);
  });
});

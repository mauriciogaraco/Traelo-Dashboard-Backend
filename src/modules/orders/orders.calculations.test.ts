import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { computeItem, computeOrderTotals, computePackagingFee, roundUpToNearest10 } from './orders.calculations';

describe('roundUpToNearest10', () => {
  it('TEST2: 87 → 90', () => {
    expect(roundUpToNearest10(new Prisma.Decimal(87)).toNumber()).toBe(90);
  });

  it('TEST3: 103 → 110', () => {
    expect(roundUpToNearest10(new Prisma.Decimal(103)).toNumber()).toBe(110);
  });

  it('151 → 160', () => {
    expect(roundUpToNearest10(new Prisma.Decimal(151)).toNumber()).toBe(160);
  });

  it('160 → 160 (ya es múltiplo de 10, no sube al siguiente)', () => {
    expect(roundUpToNearest10(new Prisma.Decimal(160)).toNumber()).toBe(160);
  });

  it('0 → 0', () => {
    expect(roundUpToNearest10(new Prisma.Decimal(0)).toNumber()).toBe(0);
  });
});

describe('computeOrderTotals', () => {
  it('TEST4: pedido multi-negocio — platformFee es la suma de comisiones ya redondeada, y el total la incluye', () => {
    const totals = computeOrderTotals({
      subtotal: new Prisma.Decimal(6000),
      rawCommissionSum: new Prisma.Decimal(90).plus(40).plus(30), // DLM + Cronos + Los Macus
      deliveryFee: new Prisma.Decimal(250),
    });

    expect(totals.productsTotal.toNumber()).toBe(6000);
    expect(totals.platformFee.toNumber()).toBe(160);
    expect(totals.total.toNumber()).toBe(6410);
  });

  it('el redondeo ocurre sobre la suma total de comisiones, no por negocio', () => {
    // Ejemplo del enunciado: producto 1000 CUP, comisión 3% => 30, mensajería 250, servicio 30 -> total 1280
    const totals = computeOrderTotals({
      subtotal: new Prisma.Decimal(1000),
      rawCommissionSum: new Prisma.Decimal(30),
      deliveryFee: new Prisma.Decimal(250),
    });

    expect(totals.platformFee.toNumber()).toBe(30);
    expect(totals.total.toNumber()).toBe(1280);
  });

  it('la comisión cruda sin redondear (87) se redondea una sola vez a 90 dentro del total', () => {
    const totals = computeOrderTotals({
      subtotal: new Prisma.Decimal(1000),
      rawCommissionSum: new Prisma.Decimal(87),
      deliveryFee: new Prisma.Decimal(0),
    });
    expect(totals.platformFee.toNumber()).toBe(90);
  });
});

describe('computePackagingFee', () => {
  it('sin capacity: un empaque por unidad', () => {
    expect(computePackagingFee(50, 3).toNumber()).toBe(150);
  });

  it('con capacity: redondea siempre hacia arriba (14 unidades, capacity 6 → 3 empaques)', () => {
    expect(computePackagingFee(100, 14, 6).toNumber()).toBe(300);
  });

  it('con capacity exacta (12 unidades, capacity 6 → exactamente 2 empaques, sin sobrante)', () => {
    expect(computePackagingFee(100, 12, 6).toNumber()).toBe(200);
  });

  it('1 unidad con capacity grande: igual cobra 1 empaque', () => {
    expect(computePackagingFee(80, 1, 10).toNumber()).toBe(80);
  });

  it('precio 0 ("sin empaque" con nombre) no cobra nada', () => {
    expect(computePackagingFee(0, 5).toNumber()).toBe(0);
  });
});

describe('computeItem con empaque', () => {
  it('sin empaque: packagingName null y packagingFee 0, subtotal solo de producto', () => {
    const priced = computeItem({ productId: 'p1', quantity: 2, unitPrice: 500 }, 'Pizza');
    expect(priced.subtotal.toNumber()).toBe(1000);
    expect(priced.packagingName).toBeNull();
    expect(priced.packagingFee.toNumber()).toBe(0);
  });

  it('con empaque: packagingFee viaja aparte, subtotal del producto no lo incluye', () => {
    const priced = computeItem(
      { productId: 'p1', quantity: 2, unitPrice: 500, packagingName: 'Caja grande', packagingFee: 100 },
      'Pizza',
    );
    expect(priced.subtotal.toNumber()).toBe(1000);
    expect(priced.packagingName).toBe('Caja grande');
    expect(priced.packagingFee.toNumber()).toBe(100);
  });
});

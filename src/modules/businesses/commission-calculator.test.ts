import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { computeGroupCommission, computeLineCommission } from './commission-calculator';

describe('commission-calculator', () => {
  it('TEST1: negocio PERCENTAGE — 1000 CUP al 3% = 30 CUP', () => {
    const business = {
      commissionType: 'PERCENTAGE' as const,
      commissionPercentage: new Prisma.Decimal(3),
      defaultProductCommissionAmount: null,
    };

    const result = computeGroupCommission(business, new Prisma.Decimal(1000), []);

    expect(result.commissionEarned.toNumber()).toBe(30);
    expect(result.commissionTypeSnapshot).toBe('PERCENTAGE');
    expect(result.commissionRateSnapshot?.toNumber()).toBe(3);
  });

  it('TEST4: tres negocios, cada uno calcula su comisión con su propio %', () => {
    const dlm = computeGroupCommission(
      {
        commissionType: 'PERCENTAGE',
        commissionPercentage: new Prisma.Decimal(3),
        defaultProductCommissionAmount: null,
      },
      new Prisma.Decimal(3000),
      [],
    );
    const cronos = computeGroupCommission(
      {
        commissionType: 'PERCENTAGE',
        commissionPercentage: new Prisma.Decimal(2),
        defaultProductCommissionAmount: null,
      },
      new Prisma.Decimal(2000),
      [],
    );
    const losMacus = computeGroupCommission(
      {
        commissionType: 'PERCENTAGE',
        commissionPercentage: new Prisma.Decimal(3),
        defaultProductCommissionAmount: null,
      },
      new Prisma.Decimal(1000),
      [],
    );

    expect(dlm.commissionEarned.toNumber()).toBe(90);
    expect(cronos.commissionEarned.toNumber()).toBe(40);
    expect(losMacus.commissionEarned.toNumber()).toBe(30);
  });

  it('FIXED_PER_PRODUCT: usa el monto por defecto del negocio si el producto no tiene comisión propia', () => {
    const business = {
      commissionType: 'FIXED_PER_PRODUCT' as const,
      commissionPercentage: null,
      defaultProductCommissionAmount: new Prisma.Decimal(15),
    };

    const lineCommission = computeLineCommission(business, null, 2);
    expect(lineCommission.toNumber()).toBe(30); // 15 CUP/unidad × 2

    const result = computeGroupCommission(business, new Prisma.Decimal(200), [lineCommission]);
    expect(result.commissionEarned.toNumber()).toBe(30);
    expect(result.commissionTypeSnapshot).toBe('FIXED_PER_PRODUCT');
    expect(result.commissionRateSnapshot).toBeNull();
  });

  it('FIXED_PER_PRODUCT: la comisión propia del producto tiene prioridad sobre el monto por defecto', () => {
    const business = {
      commissionType: 'FIXED_PER_PRODUCT' as const,
      commissionPercentage: null,
      defaultProductCommissionAmount: new Prisma.Decimal(15),
    };
    const product = { commission: { commissionAmount: new Prisma.Decimal(80) } };

    const lineCommission = computeLineCommission(business, product, 1);
    expect(lineCommission.toNumber()).toBe(80);
  });

  it('PERCENTAGE nunca aporta comisión por línea (solo a nivel de negocio)', () => {
    const business = {
      commissionType: 'PERCENTAGE' as const,
      commissionPercentage: new Prisma.Decimal(3),
      defaultProductCommissionAmount: null,
    };
    expect(computeLineCommission(business, null, 5).toNumber()).toBe(0);
  });
});

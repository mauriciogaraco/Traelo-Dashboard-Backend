import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { startOfBusinessDay, endOfBusinessDay } from '../../shared/date-range';
import { computeCustomerTrend, computeRetentionCohorts } from './analytics.service';

// Datos sintéticos, no contra la base de datos compartida (que tiene tráfico real todo el
// tiempo y haría que cualquier conteo exacto fuera poco confiable como assertion de test).

describe('computeCustomerTrend', () => {
  it('clasifica nuevo/recurrente por día y no confunde el primer pedido histórico con "nuevo cada día"', () => {
    const aug1 = new Date('2026-08-01T15:00:00Z');
    const aug2 = new Date('2026-08-02T15:00:00Z');
    const aug3 = new Date('2026-08-03T15:00:00Z');
    const beforeRange = new Date('2026-07-01T15:00:00Z');

    const range = { from: startOfBusinessDay(aug1), to: endOfBusinessDay(aug3) };
    const firstOrderByPhone = new Map<string, Date | null>([
      ['A', aug1], // "nace" como cliente el día 1
      ['B', beforeRange], // ya existía antes del rango
    ]);
    const orders = [
      { customerPhone: 'A', completedAt: aug1, total: new Prisma.Decimal(1000) },
      { customerPhone: 'B', completedAt: aug1, total: new Prisma.Decimal(300) },
      { customerPhone: 'A', completedAt: aug2, total: new Prisma.Decimal(500) },
    ];

    const points = computeCustomerTrend(orders, firstOrderByPhone, range);

    expect(points).toHaveLength(3);

    expect(points[0]).toMatchObject({
      date: '2026-08-01',
      newCustomers: 1,
      recurringCustomers: 1,
      newRevenue: 1000,
      recurringRevenue: 300,
      retentionRate: 50,
    });

    // A volvió a pedir el día 2 — sigue siendo el MISMO cliente que "nació" el día 1, así que
    // ahora cuenta como recurrente (no "nuevo otra vez").
    expect(points[1]).toMatchObject({
      date: '2026-08-02',
      newCustomers: 0,
      recurringCustomers: 1,
      recurringRevenue: 500,
      retentionRate: 100,
    });

    // Día sin pedidos — zero-fill, no un hueco en la serie.
    expect(points[2]).toMatchObject({
      date: '2026-08-03',
      newCustomers: 0,
      recurringCustomers: 0,
      retentionRate: 0,
    });
  });
});

describe('computeRetentionCohorts', () => {
  it('cuenta el tamaño de la cohorte aunque el cliente nunca vuelva, y no confunde "sin datos" con "0%"', () => {
    const now = new Date('2026-08-15T12:00:00Z');
    const may = new Date('2026-05-15T12:00:00Z');
    const june = new Date('2026-06-15T12:00:00Z');
    const august = new Date('2026-08-05T12:00:00Z');

    // X vuelve en junio y agosto pero se salta julio (mes 2). Y solo pide una vez, en mayo, y
    // nunca vuelve.
    const orders = [
      { customerPhone: 'X', completedAt: may },
      { customerPhone: 'X', completedAt: june },
      { customerPhone: 'X', completedAt: august },
      { customerPhone: 'Y', completedAt: may },
    ];

    const cohorts = computeRetentionCohorts(orders, 4, now);

    expect(cohorts.map((c) => c.cohortMonth)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);

    const mayCohort = cohorts.find((c) => c.cohortMonth === '2026-05');
    expect(mayCohort?.cohortSize).toBe(2); // X e Y, aunque Y nunca vuelva
    expect(mayCohort?.retention).toEqual([100, 50, 0, 50]); // mes0..mes3: ambos, solo X, ninguno, solo X

    // Junio y julio nunca tuvieron adquisiciones — cohorte vacía, null (sin datos), no 0%.
    const juneCohort = cohorts.find((c) => c.cohortMonth === '2026-06');
    expect(juneCohort?.cohortSize).toBe(0);
    expect(juneCohort?.retention.every((value) => value === null)).toBe(true);
  });
});

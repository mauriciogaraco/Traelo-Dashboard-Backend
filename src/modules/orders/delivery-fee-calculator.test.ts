import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { computeAppDeliveryFee } from './delivery-fee-calculator';

// Enero: Cuba está en horario estándar (UTC-5), sin ambigüedad de horario de verano.
const DAY = new Date('2026-01-15T14:00:00.000Z'); // 09:00 La Habana
const NIGHT = new Date('2026-01-16T00:30:00.000Z'); // 19:30 La Habana (día anterior)

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe('computeAppDeliveryFee', () => {
  it('un solo negocio de día: solo la tarifa base', () => {
    const fee = computeAppDeliveryFee([decimal(250)], DAY);
    expect(fee.toNumber()).toBe(250);
  });

  it('un solo negocio de noche: tarifa base + recargo nocturno', () => {
    const fee = computeAppDeliveryFee([decimal(250)], NIGHT);
    expect(fee.toNumber()).toBe(350);
  });

  it('dos negocios de 250 de día: 250 + 100 por negocio extra', () => {
    const fee = computeAppDeliveryFee([decimal(250), decimal(250)], DAY);
    expect(fee.toNumber()).toBe(350);
  });

  it('dos negocios de 250 de noche: 250 + 100 extra + 100 nocturno', () => {
    const fee = computeAppDeliveryFee([decimal(250), decimal(250)], NIGHT);
    expect(fee.toNumber()).toBe(450);
  });

  it('negocio de 250 + negocio de 350: toma el mayor (350) + 100 extra, no se suman las bases', () => {
    const fee = computeAppDeliveryFee([decimal(250), decimal(350)], DAY);
    expect(fee.toNumber()).toBe(450);
  });

  it('dos negocios de 350: 350 + 100 por negocio extra', () => {
    const fee = computeAppDeliveryFee([decimal(350), decimal(350)], DAY);
    expect(fee.toNumber()).toBe(450);
  });

  it('lanza si no se pasa ningún negocio', () => {
    expect(() => computeAppDeliveryFee([], DAY)).toThrow();
  });
});

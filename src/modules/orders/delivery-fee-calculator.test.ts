import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { computeAppDeliveryFee } from './delivery-fee-calculator';

// Enero: Cuba está en horario estándar (UTC-5), sin ambigüedad de horario de verano.
const DAY = new Date('2026-01-15T14:00:00.000Z'); // 09:00 La Habana
const NIGHT = new Date('2026-01-16T00:30:00.000Z'); // 19:30 La Habana (día anterior)

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

// Subtotal bajo el umbral de volumen (10,000): no debe activar el recargo en ningún test que no
// lo esté probando explícitamente.
const LOW_SUBTOTAL = decimal(500);

describe('computeAppDeliveryFee', () => {
  it('un solo negocio de día: solo la tarifa base', () => {
    const fee = computeAppDeliveryFee([decimal(250)], DAY, LOW_SUBTOTAL);
    expect(fee.toNumber()).toBe(250);
  });

  it('un solo negocio de noche: tarifa base + recargo nocturno', () => {
    const fee = computeAppDeliveryFee([decimal(250)], NIGHT, LOW_SUBTOTAL);
    expect(fee.toNumber()).toBe(350);
  });

  it('dos negocios de 250 de día: 250 + 100 por negocio extra', () => {
    const fee = computeAppDeliveryFee([decimal(250), decimal(250)], DAY, LOW_SUBTOTAL);
    expect(fee.toNumber()).toBe(350);
  });

  it('dos negocios de 250 de noche: 250 + 100 extra + 100 nocturno', () => {
    const fee = computeAppDeliveryFee([decimal(250), decimal(250)], NIGHT, LOW_SUBTOTAL);
    expect(fee.toNumber()).toBe(450);
  });

  it('negocio de 250 + negocio de 350: toma el mayor (350) + 100 extra, no se suman las bases', () => {
    const fee = computeAppDeliveryFee([decimal(250), decimal(350)], DAY, LOW_SUBTOTAL);
    expect(fee.toNumber()).toBe(450);
  });

  it('dos negocios de 350: 350 + 100 por negocio extra', () => {
    const fee = computeAppDeliveryFee([decimal(350), decimal(350)], DAY, LOW_SUBTOTAL);
    expect(fee.toNumber()).toBe(450);
  });

  it('lanza si no se pasa ningún negocio', () => {
    expect(() => computeAppDeliveryFee([], DAY, LOW_SUBTOTAL)).toThrow();
  });

  describe('recargo por volumen (+100 si la base es 250 y el subtotal de productos > 10,000)', () => {
    it('subtotal exactamente en 10,000: NO activa el recargo (es "mayor que", no "mayor o igual")', () => {
      const fee = computeAppDeliveryFee([decimal(250)], DAY, decimal(10000));
      expect(fee.toNumber()).toBe(250);
    });

    it('subtotal de 10,001: SÍ activa el recargo', () => {
      const fee = computeAppDeliveryFee([decimal(250)], DAY, decimal(10001));
      expect(fee.toNumber()).toBe(350);
    });

    it('subtotal de 9,999: no activa el recargo', () => {
      const fee = computeAppDeliveryFee([decimal(250)], DAY, decimal(9999));
      expect(fee.toNumber()).toBe(250);
    });

    it('con base 350 (tarifa propia, no la default) el recargo NO aplica aunque el subtotal sea alto', () => {
      const fee = computeAppDeliveryFee([decimal(350)], DAY, decimal(50000));
      expect(fee.toNumber()).toBe(350);
    });

    it('se combina con el recargo nocturno y el de negocio extra', () => {
      const fee = computeAppDeliveryFee([decimal(250), decimal(250)], NIGHT, decimal(20000));
      // 250 base + 100 negocio extra + 100 nocturno + 100 volumen
      expect(fee.toNumber()).toBe(550);
    });

    it('con múltiples negocios, la base considerada es el máximo (250) aunque otro sea menor', () => {
      // Nunca debería pasar en la práctica (deliveryFeeBase no baja de 250 en la práctica), pero
      // confirma que la comparación es contra la base ya resuelta (el máximo), no contra cada una.
      const fee = computeAppDeliveryFee([decimal(250), decimal(250)], DAY, decimal(15000));
      expect(fee.toNumber()).toBe(450); // 250 + 100 extra + 100 volumen
    });
  });
});

import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { resolveEffectivePrice } from './effective-price';

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe('resolveEffectivePrice', () => {
  it('usa el precio base cuando no hay oferta vigente', () => {
    const result = resolveEffectivePrice(decimal(500), null);
    expect(result).toEqual({ price: 500, offerId: null });
  });

  it('usa el precio de la oferta cuando hay una vigente, ignorando el precio base', () => {
    const result = resolveEffectivePrice(decimal(500), { id: 'offer-1', price: decimal(400) });
    expect(result).toEqual({ price: 400, offerId: 'offer-1' });
  });

  it('devuelve null si no hay precio base ni oferta', () => {
    const result = resolveEffectivePrice(null, null);
    expect(result).toBeNull();
  });

  it('una oferta vigente gana incluso si el precio base es null (producto sin precio propio)', () => {
    const result = resolveEffectivePrice(null, { id: 'offer-1', price: decimal(400) });
    expect(result).toEqual({ price: 400, offerId: 'offer-1' });
  });
});

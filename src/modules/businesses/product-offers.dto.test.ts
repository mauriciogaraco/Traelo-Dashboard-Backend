import { describe, expect, it } from 'vitest';
import { createOfferSchema, updateOfferSchema } from './product-offers.dto';

describe('createOfferSchema', () => {
  it('acepta cuando startsAt es anterior a endsAt', () => {
    const result = createOfferSchema.safeParse({
      price: 400,
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-01-08T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza cuando startsAt no es anterior a endsAt', () => {
    const result = createOfferSchema.safeParse({
      price: 400,
      startsAt: '2026-01-08T00:00:00.000Z',
      endsAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza fechas inválidas sin explotar (400 limpio, no 500)', () => {
    const result = createOfferSchema.safeParse({
      price: 400,
      startsAt: 'no-es-una-fecha',
      endsAt: '2026-01-08T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza precio negativo', () => {
    const result = createOfferSchema.safeParse({
      price: -1,
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-01-08T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateOfferSchema', () => {
  it('permite actualizar solo active, sin fechas', () => {
    const result = updateOfferSchema.safeParse({ active: false });
    expect(result.success).toBe(true);
  });

  it('valida el orden de fechas solo cuando vienen ambas', () => {
    const onlyStarts = updateOfferSchema.safeParse({ startsAt: '2026-01-01T00:00:00.000Z' });
    expect(onlyStarts.success).toBe(true);

    const invalidOrder = updateOfferSchema.safeParse({
      startsAt: '2026-01-08T00:00:00.000Z',
      endsAt: '2026-01-01T00:00:00.000Z',
    });
    expect(invalidOrder.success).toBe(false);
  });
});

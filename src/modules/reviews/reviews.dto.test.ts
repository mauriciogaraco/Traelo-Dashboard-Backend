import { describe, expect, it } from 'vitest';
import { businessReviewsSchema, delivererReviewSchema, ratingSchema } from './reviews.dto';

const BUSINESS_A = 'clx0000000000000000000000';
const BUSINESS_B = 'clx0000000000000000000001';

describe('ratingSchema (1.0 a 5.0, paso 0.1)', () => {
  it.each([1, 1.0, 1.1, 2.5, 3.3, 4.7, 4.9, 5, 5.0])('acepta %s', (value) => {
    expect(ratingSchema.safeParse(value).success).toBe(true);
  });

  it.each([0, 0.9, 0.99, -1, 5.1, 6, 100])('rechaza fuera de rango: %s', (value) => {
    expect(ratingSchema.safeParse(value).success).toBe(false);
  });

  it.each([4.75, 4.999, 3.14159, 1.05])('rechaza más de un decimal: %s', (value) => {
    expect(ratingSchema.safeParse(value).success).toBe(false);
  });

  it('acepta todos los valores de 1.0 a 5.0 en pasos de 0.1 (sin falsos rechazos por coma flotante)', () => {
    for (let tenths = 10; tenths <= 50; tenths++) {
      expect(ratingSchema.safeParse(tenths / 10).success).toBe(true);
    }
  });

  it('no coacciona strings ni valores no numéricos', () => {
    expect(ratingSchema.safeParse('4.5').success).toBe(false);
    expect(ratingSchema.safeParse(null).success).toBe(false);
    expect(ratingSchema.safeParse(Number.NaN).success).toBe(false);
    expect(ratingSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });
});

describe('delivererReviewSchema', () => {
  it('acepta solo {rating} y descarta un delivererId enviado por el cliente', () => {
    const result = delivererReviewSchema.safeParse({ rating: 4.7, delivererId: 'otro' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ rating: 4.7 });
  });
});

describe('businessReviewsSchema', () => {
  it('acepta varios negocios distintos', () => {
    const result = businessReviewsSchema.safeParse({
      reviews: [
        { businessId: BUSINESS_A, rating: 5 },
        { businessId: BUSINESS_B, rating: 3.4 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rechaza lista vacía, negocio repetido, id inválido y rating inválido', () => {
    expect(businessReviewsSchema.safeParse({ reviews: [] }).success).toBe(false);
    expect(
      businessReviewsSchema.safeParse({
        reviews: [
          { businessId: BUSINESS_A, rating: 5 },
          { businessId: BUSINESS_A, rating: 4 },
        ],
      }).success,
    ).toBe(false);
    expect(
      businessReviewsSchema.safeParse({ reviews: [{ businessId: 'no-cuid', rating: 5 }] }).success,
    ).toBe(false);
    expect(
      businessReviewsSchema.safeParse({ reviews: [{ businessId: BUSINESS_A, rating: 5.5 }] })
        .success,
    ).toBe(false);
  });
});

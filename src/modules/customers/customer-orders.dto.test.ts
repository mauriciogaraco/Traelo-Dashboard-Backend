import { describe, expect, it } from 'vitest';
import { createAppOrderSchema } from './customer-orders.dto';

const validBusinesses = [
  {
    businessId: 'clx0000000000000000000000',
    items: [{ productId: 'clx0000000000000000000001', quantity: 1 }],
  },
];

describe('createAppOrderSchema', () => {
  it('acepta con addressId (sin address)', () => {
    const result = createAppOrderSchema.safeParse({
      addressId: 'clx0000000000000000000002',
      businesses: validBusinesses,
    });
    expect(result.success).toBe(true);
  });

  it('acepta con address libre (sin addressId)', () => {
    const result = createAppOrderSchema.safeParse({
      address: 'Calle 10 #123',
      businesses: validBusinesses,
    });
    expect(result.success).toBe(true);
  });

  it('rechaza si no viene ni addressId ni address', () => {
    const result = createAppOrderSchema.safeParse({ businesses: validBusinesses });
    expect(result.success).toBe(false);
  });

  it('rechaza si businesses viene vacío', () => {
    const result = createAppOrderSchema.safeParse({
      address: 'Calle 10 #123',
      businesses: [],
    });
    expect(result.success).toBe(false);
  });

  it('no acepta unitPrice, deliveryFee ni platformFeeOverride en el payload (se ignoran, no rompen el parse)', () => {
    const result = createAppOrderSchema.parse({
      address: 'Calle 10 #123',
      deliveryFee: 0,
      platformFeeOverride: 0,
      businesses: [
        {
          businessId: 'clx0000000000000000000000',
          items: [{ productId: 'clx0000000000000000000001', quantity: 1, unitPrice: 0.01 }],
        },
      ],
    });
    // Zod por default descarta claves no declaradas en el schema — ni deliveryFee,
    // platformFeeOverride ni unitPrice del item deberían sobrevivir al parse.
    expect(result).not.toHaveProperty('deliveryFee');
    expect(result).not.toHaveProperty('platformFeeOverride');
    expect(result.businesses[0]?.items[0]).not.toHaveProperty('unitPrice');
  });
});

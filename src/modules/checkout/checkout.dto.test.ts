import { describe, expect, it } from 'vitest';
import { checkoutOrderSchema } from './checkout.dto';

const validBusinesses = [
  {
    businessId: 'clx0000000000000000000000',
    items: [{ productId: 'clx0000000000000000000001', quantity: 1 }],
  },
];

describe('checkoutOrderSchema — flujo con customerId', () => {
  it('acepta customerId + addressId', () => {
    const result = checkoutOrderSchema.safeParse({
      customerId: 'clx0000000000000000000002',
      addressId: 'clx0000000000000000000003',
      businesses: validBusinesses,
    });
    expect(result.success).toBe(true);
  });

  it('acepta customerId + address libre', () => {
    const result = checkoutOrderSchema.safeParse({
      customerId: 'clx0000000000000000000002',
      address: 'Calle 10 #123',
      businesses: validBusinesses,
    });
    expect(result.success).toBe(true);
  });
});

describe('checkoutOrderSchema — flujo invitado (sin customerId)', () => {
  it('acepta customerName + customerPhone + address, sin customerId', () => {
    const result = checkoutOrderSchema.safeParse({
      customerName: 'Cliente Invitado',
      customerPhone: '+53 5555 0000',
      address: 'Calle 10 #123',
      businesses: validBusinesses,
    });
    expect(result.success).toBe(true);
  });

  it('rechaza si falta customerName o customerPhone y no hay customerId', () => {
    const missingPhone = checkoutOrderSchema.safeParse({
      customerName: 'Cliente Invitado',
      address: 'Calle 10 #123',
      businesses: validBusinesses,
    });
    expect(missingPhone.success).toBe(false);

    const missingName = checkoutOrderSchema.safeParse({
      customerPhone: '+53 5555 0000',
      address: 'Calle 10 #123',
      businesses: validBusinesses,
    });
    expect(missingName.success).toBe(false);
  });

  it('rechaza addressId sin customerId (un invitado no tiene direcciones guardadas)', () => {
    const result = checkoutOrderSchema.safeParse({
      customerName: 'Cliente Invitado',
      customerPhone: '+53 5555 0000',
      addressId: 'clx0000000000000000000003',
      businesses: validBusinesses,
    });
    expect(result.success).toBe(false);
  });

  it('rechaza si no viene ni customerId ni customerName/customerPhone', () => {
    const result = checkoutOrderSchema.safeParse({
      address: 'Calle 10 #123',
      businesses: validBusinesses,
    });
    expect(result.success).toBe(false);
  });
});

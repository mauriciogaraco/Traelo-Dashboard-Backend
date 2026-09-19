import { describe, expect, it } from 'vitest';
import { checkoutOrderSchema } from './checkout.dto';

const validBusinesses = [
  {
    businessId: 'clx0000000000000000000000',
    items: [{ productId: 'clx0000000000000000000001', quantity: 1 }],
  },
];

describe('checkoutOrderSchema', () => {
  it('acepta un pedido de invitado completo (nombre, teléfono y dirección)', () => {
    const result = checkoutOrderSchema.safeParse({
      customerName: 'Cliente Invitado',
      customerPhone: '+53 5555 0000',
      address: 'Calle 10 #123',
      addressReference: 'Frente al parque',
      businesses: validBusinesses,
    });
    expect(result.success).toBe(true);
  });

  it('acepta addressId o address sin nombre/teléfono (el cliente autenticado usa los de su cuenta)', () => {
    expect(
      checkoutOrderSchema.safeParse({
        addressId: 'clx0000000000000000000003',
        businesses: validBusinesses,
      }).success,
    ).toBe(true);
    expect(
      checkoutOrderSchema.safeParse({ address: 'Calle 10 #123', businesses: validBusinesses })
        .success,
    ).toBe(true);
  });

  it('exige addressId o address', () => {
    const result = checkoutOrderSchema.safeParse({
      customerName: 'Cliente',
      customerPhone: '+53 5555 0000',
      businesses: validBusinesses,
    });
    expect(result.success).toBe(false);
  });

  it('IGNORA un customerId enviado en el body: la identidad sale solo del token', () => {
    const result = checkoutOrderSchema.safeParse({
      customerId: 'clx0000000000000000000002',
      customerName: 'Cliente',
      customerPhone: '+53 5555 0000',
      address: 'Calle 10 #123',
      businesses: validBusinesses,
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('customerId');
  });

  it('rechaza teléfonos sin forma de teléfono', () => {
    const result = checkoutOrderSchema.safeParse({
      customerName: 'Cliente',
      customerPhone: 'abcdefgh',
      address: 'Calle 10 #123',
      businesses: validBusinesses,
    });
    expect(result.success).toBe(false);
  });

  it('nunca acepta precios ni costos: se descartan deliveryFee y platformFeeOverride', () => {
    const result = checkoutOrderSchema.safeParse({
      customerName: 'Cliente',
      customerPhone: '+53 5555 0000',
      address: 'Calle 10 #123',
      deliveryFee: 0,
      platformFeeOverride: 0,
      businesses: validBusinesses,
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('deliveryFee');
    expect(result.data).not.toHaveProperty('platformFeeOverride');
  });
});

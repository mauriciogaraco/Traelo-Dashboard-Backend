import { describe, expect, it } from 'vitest';
import { createOrderSchema } from './orders.dto';

describe('createOrderSchema', () => {
  it('TEST5: nunca acepta que el cliente mande platformFee, commissionAmount, commissionRate o total — el backend los calcula', () => {
    const payload = {
      customerName: 'Cliente de prueba',
      customerAddress: 'Calle 1 #100',
      customerPhone: '+53 5555 0000',
      deliveryFee: 250,
      businesses: [
        {
          businessId: 'cmsf17m7t0002zsuh3rpyx6fp',
          items: [{ productName: 'Producto', quantity: 1, unitPrice: 1000 }],
        },
      ],
      // Un cliente malicioso intentando manipular las cifras financieras del pedido:
      platformFee: 999999,
      total: 1,
      commissionAmount: 1,
      commissionRate: 50,
    };

    const parsed = createOrderSchema.parse(payload);

    expect(parsed).not.toHaveProperty('platformFee');
    expect(parsed).not.toHaveProperty('total');
    expect(parsed).not.toHaveProperty('commissionAmount');
    expect(parsed).not.toHaveProperty('commissionRate');
    // El único "precio" que puede mandar el cliente es unitPrice por línea (el precio ya sin
    // markup) — todo lo demás (subtotal, comisiones, platformFee, total) lo calcula el backend.
    expect(parsed.businesses[0]?.items[0]?.unitPrice).toBe(1000);
  });
});

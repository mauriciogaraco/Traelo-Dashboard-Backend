// Tests de integración: corren contra la base de datos configurada en DATABASE_URL
// (la misma Postgres de desarrollo — el proyecto no tiene una DB de test separada).
// Cada test crea sus propios datos y el bloque afterAll los limpia.
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import * as businessesService from '../businesses/businesses.service';
import * as productsService from '../businesses/products.service';
import * as ordersService from './orders.service';

describe('snapshots históricos del pedido (integración)', () => {
  let userId: string;
  let businessAId: string;
  let businessBId: string;
  let businessCId: string;
  let productId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const user = await prisma.user.create({
      data: {
        name: 'Test Runner',
        email: `test-runner-${Date.now()}@traelo.test`,
        passwordHash,
        role: 'EMPLOYEE',
      },
    });
    userId = user.id;

    const businessA = await businessesService.createBusiness({
      name: 'DLM Test',
      phone: '+53 5555 1111',
      address: 'Calle DLM',
      commissionType: 'PERCENTAGE',
      commissionPercentage: 3,
    });
    businessAId = businessA.id;

    const businessB = await businessesService.createBusiness({
      name: 'Cronos Test',
      phone: '+53 5555 2222',
      address: 'Calle Cronos',
      commissionType: 'PERCENTAGE',
      commissionPercentage: 2,
    });
    businessBId = businessB.id;

    const businessC = await businessesService.createBusiness({
      name: 'Los Macus Test',
      phone: '+53 5555 3333',
      address: 'Calle Macus',
      commissionType: 'PERCENTAGE',
      commissionPercentage: 3,
    });
    businessCId = businessC.id;

    const product = await productsService.createProduct(businessAId, {
      name: 'Pizza familiar',
      price: 500,
    });
    productId = product.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { registeredByUserId: userId } });
    await prisma.business.deleteMany({
      where: { id: { in: [businessAId, businessBId, businessCId] } },
    });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('TEST6: cambiar el precio del producto después no altera un pedido ya creado', async () => {
    const order = await ordersService.createOrder(
      {
        customerName: 'Cliente Test',
        customerAddress: 'Calle 1 #100',
        customerPhone: '+53 5555 0000',
        deliveryFee: 100,
        businesses: [
          { businessId: businessAId, items: [{ productId, quantity: 2, unitPrice: 500 }] },
        ],
      },
      userId,
    );

    expect(order.businesses[0]?.items[0]?.unitPrice).toBe(500);
    expect(order.businesses[0]?.items[0]?.subtotal).toBe(1000);

    await prisma.product.update({ where: { id: productId }, data: { price: 600 } });

    const reloaded = await ordersService.getOrderById(order.id);
    expect(reloaded.businesses[0]?.items[0]?.unitPrice).toBe(500);
    expect(reloaded.businesses[0]?.items[0]?.subtotal).toBe(1000);
  });

  it('TEST7: cambiar el % de comisión del negocio después no altera un pedido ya creado', async () => {
    const order = await ordersService.createOrder(
      {
        customerName: 'Cliente Test',
        customerAddress: 'Calle 1 #100',
        customerPhone: '+53 5555 0000',
        deliveryFee: 0,
        businesses: [
          {
            businessId: businessAId,
            items: [{ productName: 'Item suelto', quantity: 1, unitPrice: 1000 }],
          },
        ],
      },
      userId,
    );

    expect(order.businesses[0]?.commissionEarned).toBe(30); // 3% de 1000
    expect(order.businesses[0]?.commissionRateSnapshot).toBe(3);
    expect(order.platformFee).toBe(30);

    await businessesService.updateBusiness(businessAId, { commissionPercentage: 10 });

    const reloaded = await ordersService.getOrderById(order.id);
    expect(reloaded.businesses[0]?.commissionEarned).toBe(30);
    expect(reloaded.businesses[0]?.commissionRateSnapshot).toBe(3);
    expect(reloaded.platformFee).toBe(30);

    // Restaurar el % original: businessAId se reutiliza en el siguiente test de este archivo.
    await businessesService.updateBusiness(businessAId, { commissionPercentage: 3 });
  });

  it('TEST8: pedido multi-negocio — cada negocio calcula su comisión y el Servicio Tráelo es la suma redondeada', async () => {
    const order = await ordersService.createOrder(
      {
        customerName: 'Cliente Multi',
        customerAddress: 'Calle 1 #100',
        customerPhone: '+53 5555 0000',
        deliveryFee: 250,
        businesses: [
          {
            businessId: businessAId,
            items: [{ productName: 'Item A', quantity: 1, unitPrice: 3000 }],
          },
          {
            businessId: businessBId,
            items: [{ productName: 'Item B', quantity: 1, unitPrice: 2000 }],
          },
          {
            businessId: businessCId,
            items: [{ productName: 'Item C', quantity: 1, unitPrice: 1000 }],
          },
        ],
      },
      userId,
    );

    const commissionByBusiness = Object.fromEntries(
      order.businesses.map((b) => [b.businessId, b.commissionEarned]),
    );
    expect(commissionByBusiness[businessAId]).toBe(90); // 3000 × 3%
    expect(commissionByBusiness[businessBId]).toBe(40); // 2000 × 2%
    expect(commissionByBusiness[businessCId]).toBe(30); // 1000 × 3%

    expect(order.productsTotal).toBe(6000);
    expect(order.platformFee).toBe(160); // 90 + 40 + 30, ya múltiplo de 10
    expect(order.total).toBe(6410); // 6000 + 250 + 160
  });
});

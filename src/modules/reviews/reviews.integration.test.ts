// Tests de integración de reseñas: corren contra la base de datos de DATABASE_URL (la misma
// Postgres; el proyecto no tiene una BD de test separada) y REQUIEREN que la migración
// 20260919000002_add_order_reviews ya esté aplicada. Cada test crea sus datos y el afterAll los
// borra. Cubren lo que los tests unitarios simulan: promedios/conteos reales sobre Decimal, el
// CHECK de rango 1–5, la FK compuesta pedido↔negocio y los unique anti-duplicado.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../shared/prisma';
import * as businessesService from '../businesses/businesses.service';
import * as reviewsService from './reviews.service';

describe('reseñas (integración)', () => {
  const stamp = Date.now();
  let businessAId: string;
  let businessBId: string;
  let outsideBusinessId: string;
  let userId: string;
  let delivererId: string;
  let customerId: string;
  const orderIds: string[] = [];

  async function createOrder(status: 'COMPLETED' | 'ASSIGNED', businessIds: string[]) {
    const order = await prisma.order.create({
      data: {
        customerName: 'Cliente Reviews Test',
        customerAddress: 'Calle Test',
        customerPhone: `+53559${stamp}`.slice(0, 20),
        deliveryFee: 250,
        status,
        completedAt: status === 'COMPLETED' ? new Date() : null,
        assignedAt: new Date(),
        customerId,
        delivererId,
        productsTotal: 1000,
        total: 1250,
        traeloEarning: 0,
        delivererEarning: 0,
        businesses: {
          create: businessIds.map((businessId) => ({
            businessId,
            subtotal: 500,
            commissionEarned: 0,
            businessNameSnapshot: 'Negocio Reviews Test',
          })),
        },
      },
    });
    orderIds.push(order.id);
    return order;
  }

  beforeAll(async () => {
    const make = async (name: string) =>
      (
        await businessesService.createBusiness({
          name,
          phone: '+53 5555 3030',
          address: 'Calle Test',
          commissionType: 'PERCENTAGE',
          commissionPercentage: 10,
          deliveryFeeBase: 250,
        })
      ).id;
    businessAId = await make('Reviews Test A');
    businessBId = await make('Reviews Test B');
    outsideBusinessId = await make('Reviews Test Fuera');

    const user = await prisma.user.create({
      data: {
        name: 'Mensajero Reviews Test',
        email: `reviews-test-${stamp}@example.com`,
        passwordHash: 'x',
        role: 'DELIVERER',
      },
    });
    userId = user.id;
    delivererId = (await prisma.deliverer.create({ data: { userId } })).id;
    customerId = (
      await prisma.customer.create({
        data: { name: 'Cliente Reviews Test', phone: `+53558${stamp}`.slice(0, 20) },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.businessReview.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.delivererReview.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.delete({ where: { id: customerId } });
    await prisma.deliverer.delete({ where: { id: delivererId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.business.deleteMany({
      where: { id: { in: [businessAId, businessBId, outsideBusinessId] } },
    });
  });

  const access = () => ({ kind: 'customer', customerId }) as const;

  it('guarda reseñas de mensajero y de varios negocios, y calcula promedio y conteo reales', async () => {
    const first = await createOrder('COMPLETED', [businessAId, businessBId]);
    const second = await createOrder('COMPLETED', [businessAId]);

    await reviewsService.submitDelivererReview(access(), first.id, { rating: 5 });
    await reviewsService.submitDelivererReview(access(), second.id, { rating: 4.2 });
    await reviewsService.submitBusinessReviews(access(), first.id, {
      reviews: [
        { businessId: businessAId, rating: 5 },
        { businessId: businessBId, rating: 2.5 },
      ],
    });
    await reviewsService.submitBusinessReviews(access(), second.id, {
      reviews: [{ businessId: businessAId, rating: 4.4 }],
    });

    expect(await reviewsService.getDelivererRatingSummary(delivererId)).toEqual({
      average: 4.6,
      count: 2,
    });
    // A: (5 + 4.4) / 2 = 4.7; B: 2.5
    expect(await reviewsService.getBusinessRatingSummary(businessAId)).toEqual({
      average: 4.7,
      count: 2,
    });
    expect(await reviewsService.getBusinessRatingSummary(businessBId)).toEqual({
      average: 2.5,
      count: 1,
    });
  });

  it('rechaza un pedido no completado y un duplicado (409), sin tocar la BD', async () => {
    const active = await createOrder('ASSIGNED', [businessAId]);
    await expect(
      reviewsService.submitDelivererReview(access(), active.id, { rating: 5 }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_COMPLETED' });

    const done = await createOrder('COMPLETED', [businessAId]);
    await reviewsService.submitDelivererReview(access(), done.id, { rating: 3 });
    await expect(
      reviewsService.submitDelivererReview(access(), done.id, { rating: 4 }),
    ).rejects.toMatchObject({ code: 'REVIEW_ALREADY_SUBMITTED' });
  });

  it('la BD impone los invariantes aunque el servicio se saltee: CHECK 1–5 y FK pedido↔negocio', async () => {
    const order = await createOrder('COMPLETED', [businessAId]);

    // CHECK "rating entre 1.0 y 5.0" (Decimal(2,1) también rechazaría 10.0).
    await expect(
      prisma.delivererReview.create({ data: { orderId: order.id, delivererId, rating: 5.5 } }),
    ).rejects.toThrow();
    await expect(
      prisma.delivererReview.create({ data: { orderId: order.id, delivererId, rating: 0.9 } }),
    ).rejects.toThrow();

    // FK compuesta: un negocio que no está en ESE pedido no se puede valorar.
    await expect(
      prisma.businessReview.create({
        data: { orderId: order.id, businessId: outsideBusinessId, rating: 5 },
      }),
    ).rejects.toThrow();
  });

  it('el servicio rechaza un negocio fuera del pedido antes de escribir', async () => {
    const order = await createOrder('COMPLETED', [businessAId]);
    await expect(
      reviewsService.submitBusinessReviews(access(), order.id, {
        reviews: [{ businessId: outsideBusinessId, rating: 5 }],
      }),
    ).rejects.toMatchObject({ code: 'BUSINESS_NOT_IN_ORDER' });
  });

  it('un cliente no puede valorar el pedido de otro (404)', async () => {
    const order = await createOrder('COMPLETED', [businessAId]);
    await expect(
      reviewsService.submitDelivererReview(
        { kind: 'customer', customerId: 'cnotmyaccount000000000' },
        order.id,
        { rating: 5 },
      ),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });
});

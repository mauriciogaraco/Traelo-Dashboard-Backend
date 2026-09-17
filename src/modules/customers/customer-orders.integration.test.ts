// Tests de integración: corren contra la base de datos configurada en DATABASE_URL
// (la misma Postgres de desarrollo — el proyecto no tiene una DB de test separada).
// Cada test crea sus propios datos y el bloque afterAll los limpia.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CartChangedError } from '../../shared/errors';
import { getBusinessHour } from '../../shared/date-range';
import { prisma } from '../../shared/prisma';
import * as businessesService from '../businesses/businesses.service';
import * as productsService from '../businesses/products.service';
import * as customersService from './customers.service';
import * as addressesService from './customer-addresses.service';
import * as customerOrdersService from './customer-orders.service';
import * as ordersService from '../orders/orders.service';

describe('creación de pedidos desde la app (integración)', () => {
  let businessAId: string; // deliveryFeeBase 250
  let businessBId: string; // deliveryFeeBase 350 (simula DLM)
  let productAId: string; // sin oferta
  let productBId: string; // con oferta activa
  let unavailableProductId: string;
  let customerId: string;
  let addressId: string;

  // El día/noche del recargo depende de la hora real al correr el test — se calcula acá con
  // el mismo helper que usa el service, en vez de fijar un horario que podría no coincidir.
  const isNight = getBusinessHour(new Date()) >= 19;

  beforeAll(async () => {
    const businessA = await businessesService.createBusiness({
      name: 'Pizzería Integration Test',
      phone: '+53 5555 1010',
      address: 'Calle Test A',
      commissionType: 'PERCENTAGE',
      commissionPercentage: 10,
      deliveryFeeBase: 250,
    });
    businessAId = businessA.id;

    const businessB = await businessesService.createBusiness({
      name: 'DLM Integration Test',
      phone: '+53 5555 2020',
      address: 'Calle Test B',
      commissionType: 'PERCENTAGE',
      commissionPercentage: 10,
      deliveryFeeBase: 350,
    });
    businessBId = businessB.id;

    const productA = await productsService.createProduct(businessAId, {
      name: 'Producto sin oferta',
      price: 500,
    });
    productAId = productA.id;

    const productB = await productsService.createProduct(businessAId, {
      name: 'Producto con oferta',
      price: 600,
    });
    productBId = productB.id;
    await prisma.productOffer.create({
      data: {
        productId: productBId,
        price: 400,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60_000),
        active: true,
      },
    });

    const unavailableProduct = await productsService.createProduct(businessAId, {
      name: 'Producto agotado',
      price: 300,
    });
    unavailableProductId = unavailableProduct.id;
    await productsService.setProductAvailability(businessAId, unavailableProductId, {
      available: false,
    });

    const customer = await customersService.createCustomer({
      name: 'Cliente Integration Test',
      phone: `+53 555 ${Date.now()}`.slice(0, 20),
    });
    customerId = customer.id;

    const address = await addressesService.createAddress(customerId, {
      label: 'Casa',
      address: 'Calle Guardada #100',
      reference: 'Frente al parque',
      isDefault: true,
    });
    addressId = address.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { customerId } });
    await prisma.customer.delete({ where: { id: customerId } });
    await prisma.business.deleteMany({ where: { id: { in: [businessAId, businessBId] } } });
  });

  // El cooldown antispam (ver orders.service.ts: assertNoRecentPendingAppOrder) bloquea un
  // pedido nuevo mientras el anterior siga PENDING — como casi todos los tests de este
  // archivo crean un pedido para el mismo customerId/teléfono, hay que cerrar cada uno para
  // no bloquear al siguiente test. Más simple que parchear cada `it` a mano.
  afterEach(async () => {
    await prisma.order.updateMany({
      where: { customerId, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  });

  it('resuelve el precio desde Product.price cuando no hay oferta vigente', async () => {
    const order = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 2 }] }],
    });

    const line = order.businesses[0]?.items[0];
    expect(line?.unitPrice).toBe(500);
    expect(order.productsTotal).toBe(1000);
  });

  it('resuelve el precio desde la oferta vigente, ignorando Product.price', async () => {
    const order = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productBId, quantity: 1 }] }],
    });

    expect(order.businesses[0]?.items[0]?.unitPrice).toBe(400);
  });

  it('usa la dirección guardada como snapshot (customerAddress/addressReference)', async () => {
    const order = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    expect(order.customerAddress).toBe('Calle Guardada #100');
    expect(order.addressReference).toBe('Frente al parque');
    expect(order.source).toBe('APP');
    expect(order.customerId).toBe(customerId);
    expect(order.registeredByUserId).toBeNull();
  });

  it('calcula deliveryFee = tarifa base cuando el pedido es de un solo negocio', async () => {
    const order = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    expect(order.deliveryFee).toBe(250 + (isNight ? 100 : 0));
  });

  it('calcula deliveryFee = tarifa más alta + 100 por negocio extra, en pedidos multi-negocio', async () => {
    const order = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [
        { businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] },
        { businessId: businessBId, items: [{ productId: productAId, quantity: 1 }] },
      ],
    });

    // Nota: usa productAId (que pertenece a businessAId) también como línea de businessBId
    // solo para simplificar el fixture — este test no valida a qué negocio pertenece cada
    // producto, eso ya lo cubre products.service.
    expect(order.deliveryFee).toBe(350 + 100 + (isNight ? 100 : 0));
  });

  it('actualiza Customer.lastOrderAt al crear el pedido', async () => {
    const before = await customersService.getCustomer(customerId);
    expect(before.lastOrderAt).toBeNull();

    await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    const after = await customersService.getCustomer(customerId);
    expect(after.lastOrderAt).not.toBeNull();
  });

  // Fase 11: un producto/negocio inválido ya no tira un error genérico del primer ítem que
  // falla — junta TODO el diff del carrito en un único CartChangedError (code: CART_CHANGED).

  it('CART_CHANGED: reporta un producto no disponible (available=false) sin crear el pedido', async () => {
    let caught: unknown;
    try {
      await customerOrdersService.createAppOrder(customerId, {
        addressId,
        businesses: [
          { businessId: businessAId, items: [{ productId: unavailableProductId, quantity: 1 }] },
        ],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CartChangedError);
    const changes = (caught as CartChangedError).details as {
      changes: { reason: string; productId?: string }[];
    };
    expect(changes.changes).toContainEqual(
      expect.objectContaining({ reason: 'PRODUCT_UNAVAILABLE', productId: unavailableProductId }),
    );
  });

  it('CART_CHANGED: reporta un negocio que no acepta pedidos (acceptingOrders=false)', async () => {
    await businessesService.setAcceptingOrders(businessAId, { acceptingOrders: false });

    let caught: unknown;
    try {
      await customerOrdersService.createAppOrder(customerId, {
        addressId,
        businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CartChangedError);
    const changes = (caught as CartChangedError).details as {
      changes: { reason: string; businessId?: string }[];
    };
    expect(changes.changes).toContainEqual(
      expect.objectContaining({ reason: 'BUSINESS_NOT_ACCEPTING_ORDERS', businessId: businessAId }),
    );

    await businessesService.setAcceptingOrders(businessAId, { acceptingOrders: true });
  });

  it('CART_CHANGED: reporta PRICE_CHANGED cuando expectedPrice no coincide con el precio actual', async () => {
    let caught: unknown;
    try {
      await customerOrdersService.createAppOrder(customerId, {
        addressId,
        businesses: [
          {
            businessId: businessAId,
            items: [{ productId: productAId, quantity: 1, expectedPrice: 999 }],
          },
        ],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CartChangedError);
    const changes = (caught as CartChangedError).details as {
      changes: {
        reason: string;
        productId?: string;
        expectedPrice?: number;
        currentPrice?: number;
      }[];
    };
    expect(changes.changes).toContainEqual(
      expect.objectContaining({
        reason: 'PRICE_CHANGED',
        productId: productAId,
        expectedPrice: 999,
        currentPrice: 500,
      }),
    );
  });

  it('no reporta CART_CHANGED cuando expectedPrice sí coincide con el precio actual', async () => {
    const order = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [
        {
          businessId: businessAId,
          items: [{ productId: productAId, quantity: 1, expectedPrice: 500 }],
        },
      ],
    });

    expect(order.businesses[0]?.items[0]?.unitPrice).toBe(500);
  });

  it('idempotencia: la misma clientRequestId no crea un pedido duplicado', async () => {
    const clientRequestId = `test-idempotency-${Date.now()}`;

    const first = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      clientRequestId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    const second = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      clientRequestId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    expect(second.id).toBe(first.id);
    expect(second.orderNumber).toBe(first.orderNumber);

    const count = await prisma.order.count({ where: { clientRequestId } });
    expect(count).toBe(1);
  });

  it('getCustomerOrderStatus devuelve solo orderNumber/status/updatedAt', async () => {
    const order = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    const status = await customerOrdersService.getCustomerOrderStatus(customerId, order.id);
    expect(status).toEqual({
      orderNumber: order.orderNumber,
      status: 'PENDING',
      updatedAt: order.updatedAt,
    });
  });

  it('getCustomerOrderStatus rechaza consultar un pedido de otro cliente', async () => {
    const otherCustomer = await customersService.createCustomer({
      name: 'Otro Cliente',
      phone: `+53 555 other-${Date.now()}`.slice(0, 20),
    });

    const order = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    await expect(
      customerOrdersService.getCustomerOrderStatus(otherCustomer.id, order.id),
    ).rejects.toThrow();

    await prisma.customer.delete({ where: { id: otherCustomer.id } });
  });

  it('repeatOrder reconstruye el carrito sin cambios cuando nada varió', async () => {
    const order = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 2 }] }],
    });

    const cart = await customerOrdersService.repeatOrder(customerId, order.id);

    expect(cart.hasChanges).toBe(false);
    expect(cart.businesses[0]?.items[0]).toMatchObject({
      productId: productAId,
      quantity: 2,
      originalUnitPrice: 500,
      currentPrice: 500,
      available: true,
    });
  });

  it('repeatOrder marca hasChanges cuando el precio cambió desde el pedido original', async () => {
    const order = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    await productsService.updateProduct(businessAId, productAId, { price: 700 });

    const cart = await customerOrdersService.repeatOrder(customerId, order.id);

    expect(cart.hasChanges).toBe(true);
    expect(cart.businesses[0]?.items[0]).toMatchObject({
      originalUnitPrice: 500,
      currentPrice: 700,
    });

    await productsService.updateProduct(businessAId, productAId, { price: 500 });
  });

  it('repeatOrder marca available=false y hasChanges cuando el producto ya no está disponible', async () => {
    const order = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    await productsService.setProductAvailability(businessAId, productAId, { available: false });

    const cart = await customerOrdersService.repeatOrder(customerId, order.id);

    expect(cart.hasChanges).toBe(true);
    expect(cart.businesses[0]?.items[0]).toMatchObject({ available: false, currentPrice: null });

    await productsService.setProductAvailability(businessAId, productAId, { available: true });
  });

  it('antispam: bloquea un segundo pedido del mismo teléfono mientras el primero sigue PENDING', async () => {
    const first = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    await expect(
      customerOrdersService.createAppOrder(customerId, {
        addressId,
        businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
      }),
    ).rejects.toMatchObject({ code: 'RECENT_ORDER_PENDING' });

    await ordersService.updateOrderStatus(first.id, { status: 'CANCELLED' });
  });

  it('antispam: se libera en cuanto el pedido anterior deja de estar PENDING', async () => {
    const first = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    await ordersService.updateOrderStatus(first.id, { status: 'CANCELLED' });

    const second = await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    expect(second.id).not.toBe(first.id);
  });
});

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
  let productOfBusinessBId: string; // producto del negocio B (pedidos multi-negocio)
  let unavailableProductId: string;
  let productWithPackagingId: string; // "Caja chica" sin capacity, "Caja grande" con capacity 6
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

    // Un negocio sin horario cuenta como cerrado (NO_SCHEDULE_CONFIGURED): abierto 24 h todos los días.
    for (const businessId of [businessAId, businessBId]) {
      await prisma.businessHours.createMany({
        data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          businessId,
          dayOfWeek,
          openTime: new Date(Date.UTC(1970, 0, 1, 0, 0)),
          closeTime: new Date(Date.UTC(1970, 0, 1, 23, 59)),
          closed: false,
        })),
      });
    }

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

    const productOfBusinessB = await productsService.createProduct(businessBId, {
      name: 'Producto del negocio B',
      price: 200,
    });
    productOfBusinessBId = productOfBusinessB.id;

    const unavailableProduct = await productsService.createProduct(businessAId, {
      name: 'Producto agotado',
      price: 300,
    });
    unavailableProductId = unavailableProduct.id;
    await productsService.setProductAvailability(businessAId, unavailableProductId, {
      available: false,
    });

    const productWithPackaging = await productsService.createProduct(businessAId, {
      name: 'Producto con empaque',
      price: 200,
      packaging: [
        { name: 'Caja chica', price: 50 }, // sin capacity: un empaque por unidad
        { name: 'Caja grande', price: 100, capacity: 6 }, // uno cada 6 unidades
      ],
    });
    productWithPackagingId = productWithPackaging.id;

    // POST /customers ya no existe: el cliente de prueba se crea directo en la BD.
    const customer = await prisma.customer.create({
      data: {
        name: 'Cliente Integration Test',
        phone: `+53555${Date.now()}`.slice(0, 20),
      },
    });
    customerId = customer.id;

    const address = await addressesService.createAddress(customerId, {
      label: 'Casa',
      address: 'Calle Guardada #100',
      reference: 'Frente al parque',
      isDefault: true,
    });
    addressId = address.id;
  }, 60_000);

  afterAll(async () => {
    // Si beforeAll falló (p. ej. timeout con la BD remota) estos ids quedan undefined, y Prisma
    // trata `where: { customerId: undefined }` como "sin filtro": borraría pedidos de TODOS los clientes.
    if (customerId) {
      await prisma.order.deleteMany({ where: { customerId } });
      await prisma.customer.delete({ where: { id: customerId } });
    }
    const businessIds = [businessAId, businessBId].filter(Boolean);
    if (businessIds.length > 0) {
      await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    }
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
        { businessId: businessBId, items: [{ productId: productOfBusinessBId, quantity: 1 }] },
      ],
    });

    expect(order.deliveryFee).toBe(350 + 100 + (isNight ? 100 : 0));
  });

  it('actualiza Customer.lastOrderAt al crear el pedido', async () => {
    // Los tests anteriores ya crearon pedidos para este cliente, así que no parte de null.
    const before = await customersService.getCustomer(customerId);

    await customerOrdersService.createAppOrder(customerId, {
      addressId,
      businesses: [{ businessId: businessAId, items: [{ productId: productAId, quantity: 1 }] }],
    });

    const after = await customersService.getCustomer(customerId);
    expect(after.lastOrderAt).not.toBeNull();
    expect(after.lastOrderAt!.getTime()).toBeGreaterThanOrEqual(before.lastOrderAt?.getTime() ?? 0);
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
      assignedAt: null,
      completedAt: null,
      cancelledAt: null,
      delivererName: null,
      delivererPhotoUrl: null,
      pickingUpAt: null,
      onTheWayAt: null,
    });
  });

  it('getCustomerOrderStatus rechaza consultar un pedido de otro cliente', async () => {
    const otherCustomer = await prisma.customer.create({
      data: {
        name: 'Otro Cliente',
        phone: `+53556${Date.now()}`.slice(0, 20),
      },
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

  // Fase 3 del plan: cobro de envase/empaque — Product.packaging ya existía como metadata del
  // catálogo pero nunca se cobraba en ningún pedido.
  describe('empaque', () => {
    it('sin elegir empaque: no cobra nada (packagingName null, packagingFee 0)', async () => {
      const order = await customerOrdersService.createAppOrder(customerId, {
        addressId,
        businesses: [{ businessId: businessAId, items: [{ productId: productWithPackagingId, quantity: 3 }] }],
      });

      const line = order.businesses[0]?.items[0];
      expect(line?.packagingName).toBeNull();
      expect(line?.packagingFee).toBe(0);
      expect(order.packagingTotal).toBe(0);
      expect(order.productsTotal).toBe(600); // 3 × 200, sin empaque
    });

    it('empaque sin capacity: un empaque por unidad', async () => {
      const order = await customerOrdersService.createAppOrder(customerId, {
        addressId,
        businesses: [
          {
            businessId: businessAId,
            items: [{ productId: productWithPackagingId, quantity: 3, packagingName: 'Caja chica' }],
          },
        ],
      });

      const line = order.businesses[0]?.items[0];
      expect(line?.packagingName).toBe('Caja chica');
      expect(line?.packagingFee).toBe(150); // 3 empaques × 50
      expect(order.packagingTotal).toBe(150);
      expect(order.productsTotal).toBe(750); // 600 de producto + 150 de empaque
    });

    it('empaque con capacity: redondea hacia arriba (14 unidades, capacity 6 → 3 empaques)', async () => {
      const order = await customerOrdersService.createAppOrder(customerId, {
        addressId,
        businesses: [
          {
            businessId: businessAId,
            items: [{ productId: productWithPackagingId, quantity: 14, packagingName: 'Caja grande' }],
          },
        ],
      });

      const line = order.businesses[0]?.items[0];
      expect(line?.packagingFee).toBe(300); // ceil(14/6)=3 × 100
      expect(order.packagingTotal).toBe(300);
    });

    it('el empaque NUNCA entra en la base de la comisión por %', async () => {
      // businessA es PERCENTAGE 10%. Sin empaque: comisión = 200 × 10% = 20.
      const withPackaging = await customerOrdersService.createAppOrder(customerId, {
        addressId,
        businesses: [
          {
            businessId: businessAId,
            items: [{ productId: productWithPackagingId, quantity: 1, packagingName: 'Caja chica' }],
          },
        ],
      });

      expect(withPackaging.businesses[0]?.commissionEarned).toBe(20); // 10% de 200, NO de 250
      expect(withPackaging.businesses[0]?.items[0]?.commissionAmount).toBe(0); // PERCENTAGE: la línea no lleva comisión propia
    });

    it('CART_CHANGED: reporta un nombre de empaque que no existe para ese producto', async () => {
      let caught: unknown;
      try {
        await customerOrdersService.createAppOrder(customerId, {
          addressId,
          businesses: [
            {
              businessId: businessAId,
              items: [{ productId: productWithPackagingId, quantity: 1, packagingName: 'Caja que no existe' }],
            },
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
        expect.objectContaining({ reason: 'PACKAGING_UNAVAILABLE', productId: productWithPackagingId }),
      );
    });

    it('quoteCheckout: el desglose incluye packagingTotal sin crear el pedido', async () => {
      const quote = await customerOrdersService.quoteCheckout(
        {
          businesses: [
            {
              businessId: businessAId,
              items: [{ productId: productWithPackagingId, quantity: 3, packagingName: 'Caja chica' }],
            },
          ],
        },
        customerId,
      );

      expect(quote.packagingTotal).toBe(150);
      expect(quote.productsTotal).toBe(750);
    });
  });
});

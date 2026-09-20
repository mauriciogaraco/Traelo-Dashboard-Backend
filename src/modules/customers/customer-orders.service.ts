import {
  NotFoundError,
  BadRequestError,
  CartChangedError,
  ConflictError,
} from '../../shared/errors';
import { decimalToNumber } from '../../shared/prisma';
import type { PaginationMeta } from '../../shared/http';
import * as businessesRepository from '../businesses/businesses.repository';
import * as productsRepository from '../businesses/products.repository';
import * as productOffersRepository from '../businesses/product-offers.repository';
import { resolveEffectivePrice } from '../businesses/effective-price';
import { isBusinessOpen, type BusinessOpenReason } from '../businesses/business-status.service';
import * as customersService from './customers.service';
import * as addressesRepository from './customer-addresses.repository';
import * as ordersService from '../orders/orders.service';
import type { OrderDTO, OrderQuoteDTO, CreateOrderOptions } from '../orders/orders.service';
import { createGuestAccessToken, hashGuestAccessToken } from '../guest-orders/guest-token';
import type { CreateOrderInput } from '../orders/orders.dto';
import type { OrderStatus } from '../../generated/prisma/enums';
import { computeAppDeliveryFee } from '../orders/delivery-fee-calculator';
import { RedemptionError } from '../loyalty/rewards.rules';
import type { RedemptionRequest } from '../loyalty/rewards.service';
import type {
  AppOrderBusinessInput,
  CheckoutOrderInput,
  CheckoutQuoteInput,
} from '../checkout/checkout.dto';
import type { CreateAppOrderInput, ListCustomerOrdersQuery } from './customer-orders.dto';

// Mensajes legibles por motivo — CartChange.reason abajo es el código machine-readable
// (Fase 25); esto solo arma el texto que ve una persona en `message`.
const BUSINESS_CLOSED_MESSAGES: Record<BusinessOpenReason, string> = {
  NOT_FOUND: 'no encontrado',
  INACTIVE: 'ya no pertenece a Tráelo',
  NOT_ACCEPTING_ORDERS: 'no está aceptando pedidos en este momento',
  EXCEPTIONAL_CLOSURE: 'está cerrado hoy por una excepción puntual',
  CLOSED_TODAY: 'no abre ese día de la semana',
  NO_SCHEDULE_CONFIGURED: 'no tiene horario configurado',
  OUTSIDE_HOURS: 'está fuera de su horario de atención',
};

// Varios "reason" de isBusinessOpen colapsan al mismo código público: el checklist (Fase 25)
// solo distingue BUSINESS_CLOSED de BUSINESS_NOT_ACCEPTING_ORDERS, no cada sub-motivo de
// horario/cierre.
const BUSINESS_OPEN_REASON_TO_CODE: Record<BusinessOpenReason, string> = {
  NOT_FOUND: 'BUSINESS_NOT_FOUND',
  INACTIVE: 'BUSINESS_INACTIVE',
  NOT_ACCEPTING_ORDERS: 'BUSINESS_NOT_ACCEPTING_ORDERS',
  EXCEPTIONAL_CLOSURE: 'BUSINESS_CLOSED',
  CLOSED_TODAY: 'BUSINESS_CLOSED',
  NO_SCHEDULE_CONFIGURED: 'BUSINESS_CLOSED',
  OUTSIDE_HOURS: 'BUSINESS_CLOSED',
};

export interface CartChange {
  type: 'business' | 'product';
  businessId?: string;
  productId?: string;
  reason: string;
  message: string;
  expectedPrice?: number;
  currentPrice?: number;
}

interface ResolvedItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

// Resuelve una línea del carrito contra el estado actual (producto existe/activo/disponible,
// precio efectivo). En vez de tirar un error en la primera línea que falla (Fase 11:
// CART_CHANGED), empuja un CartChange a `changes` y devuelve null — así se junta el diff
// completo del carrito en una sola pasada.
async function resolveItemForCart(
  itemInput: { productId: string; quantity: number; expectedPrice?: number },
  businessId: string,
  now: Date,
  changes: CartChange[],
): Promise<ResolvedItem | null> {
  const product = await productsRepository.findByIdForBusiness(itemInput.productId, businessId);
  if (!product) {
    changes.push({
      type: 'product',
      productId: itemInput.productId,
      reason: 'PRODUCT_NOT_FOUND',
      message: 'Producto no encontrado',
    });
    return null;
  }
  if (!product.active || !product.available) {
    changes.push({
      type: 'product',
      productId: itemInput.productId,
      reason: 'PRODUCT_UNAVAILABLE',
      message: `${product.name} ya no está disponible`,
    });
    return null;
  }

  const activeOffer = await productOffersRepository.findActiveForProduct(itemInput.productId, now);
  const effective = resolveEffectivePrice(product.price, activeOffer);
  if (effective === null) {
    changes.push({
      type: 'product',
      productId: itemInput.productId,
      reason: 'PRODUCT_UNAVAILABLE',
      message: `${product.name} no tiene un precio configurado`,
    });
    return null;
  }

  if (itemInput.expectedPrice !== undefined && itemInput.expectedPrice !== effective.price) {
    changes.push({
      type: 'product',
      productId: itemInput.productId,
      reason: 'PRICE_CHANGED',
      message: `${product.name} cambió de precio`,
      expectedPrice: itemInput.expectedPrice,
      currentPrice: effective.price,
    });
    return null;
  }

  return {
    productId: itemInput.productId,
    quantity: itemInput.quantity,
    unitPrice: effective.price,
  };
}

export interface DeliveryDestination {
  latitude: number;
  longitude: number;
}

// Ubicación (pin) que se copia al pedido como snapshot. Es OPCIONAL y su ausencia nunca frena un
// pedido. `location` undefined = usar la de la dirección guardada (si tiene); null = el cliente
// pidió explícitamente no llevar ubicación en este pedido; objeto = la de este pedido.
export function resolveDestination(
  location: { latitude: number; longitude: number } | null | undefined,
  saved: { latitude: number | null; longitude: number | null } | null,
): DeliveryDestination | null {
  if (location === null) return null;
  if (location) return { latitude: location.latitude, longitude: location.longitude };
  if (saved && saved.latitude !== null && saved.longitude !== null) {
    return { latitude: saved.latitude, longitude: saved.longitude };
  }
  return null;
}

interface OrderBasics {
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  addressReference: string | undefined;
  clientRequestId: string | undefined;
  // Pin de entrega ya resuelto (ver resolveDestination); null = sin ubicación.
  destination: DeliveryDestination | null;
  // Solo pedidos de invitado (ver createCheckoutOrder).
  guestAccessTokenHash?: string;
  // Canje de una recompensa (solo con cuenta): solo el id; el servidor resuelve todo lo demás.
  redemption?: RedemptionRequest;
}

// Valida negocios (abiertos) y productos (existen, disponibles, precio vigente) y calcula el
// delivery. Si algo cambió, junta TODO el diff en un único CartChangedError. Lo comparten la
// creación del pedido y la cotización, para que ambas resuelvan el carrito exactamente igual.
async function resolveCart(
  businessGroups: AppOrderBusinessInput[],
  now: Date,
): Promise<{ businesses: CreateOrderInput['businesses']; deliveryFee: number }> {
  const changes: CartChange[] = [];
  const deliveryFeeBases: Parameters<typeof computeAppDeliveryFee>[0] = [];
  const businesses: CreateOrderInput['businesses'] = [];

  for (const group of businessGroups) {
    const business = await businessesRepository.findById(group.businessId);
    if (!business) {
      changes.push({
        type: 'business',
        businessId: group.businessId,
        reason: 'BUSINESS_NOT_FOUND',
        message: `Negocio ${group.businessId} no encontrado`,
      });
      continue;
    }

    // isBusinessOpen es la única fuente de verdad para "¿puede recibir pedidos ahora?" —
    // combina active/acceptingOrders con horario y cierres excepcionales (hora de La Habana).
    const status = await isBusinessOpen(group.businessId, now);
    if (!status.open) {
      changes.push({
        type: 'business',
        businessId: business.id,
        reason: BUSINESS_OPEN_REASON_TO_CODE[status.reason],
        message: `${business.name} ${BUSINESS_CLOSED_MESSAGES[status.reason]}`,
      });
      continue;
    }

    deliveryFeeBases.push(business.deliveryFeeBase);

    const items: ResolvedItem[] = [];
    for (const itemInput of group.items) {
      const resolved = await resolveItemForCart(itemInput, group.businessId, now, changes);
      if (resolved) {
        items.push(resolved);
      }
    }
    businesses.push({ businessId: group.businessId, items });
  }

  // Fase 11: si algo cambió, se reporta TODO el diff junto en un único error estructurado —
  // nada se crea todavía. El cliente decide si confirma con los valores nuevos.
  if (changes.length > 0) {
    throw new CartChangedError(changes);
  }

  const deliveryFee = decimalToNumber(computeAppDeliveryFee(deliveryFeeBases, now));

  return { businesses, deliveryFee };
}

// Núcleo compartido por createAppOrder (cliente ya identificado, vía /customers/:id/orders) y
// createCheckoutOrder (invitado o cliente, vía /checkout): validar negocios+horario, resolver
// precios, calcular el delivery y crear el pedido. Los datos del cliente (nombre/teléfono/
// dirección/customerId) ya vienen resueltos por el caller — es lo único que difiere entre
// ambos flujos.
async function buildAndCreateOrder(
  basics: OrderBasics,
  businessGroups: AppOrderBusinessInput[],
): Promise<OrderDTO> {
  // Idempotencia primero, antes que cualquier otra regla: si esta request ya se procesó
  // (mismo clientRequestId), se devuelve ese pedido tal cual — el cooldown de reenvío de
  // abajo NO debe aplicar a la reproducción de una request que ya es "el mismo intento".
  if (basics.clientRequestId) {
    const existing = await ordersService.getOrderByClientRequestId(basics.clientRequestId);
    if (existing) {
      // El pedido ya existente debe ser de la MISMA identidad (misma cuenta, o ambos
      // invitados): si no, el clientRequestId no puede usarse para leer un pedido ajeno.
      if (existing.customerId !== basics.customerId) {
        throw new ConflictError(
          'Ese identificador de solicitud ya fue usado por otro pedido',
          'IDEMPOTENCY_KEY_CONFLICT',
        );
      }
      return existing;
    }
  }

  const businessIds = businessGroups.map((group) => group.businessId);
  if (new Set(businessIds).size !== businessIds.length) {
    throw new BadRequestError(
      'No se puede repetir el mismo negocio en un pedido',
      'DUPLICATE_BUSINESS',
    );
  }

  const now = new Date();

  // Antispam: bloquea un pedido NUEVO (distinto clientRequestId) mientras el cliente todavía
  // tiene uno reciente sin atender. Ver orders.service.ts para el detalle de cuándo se libera.
  await ordersService.assertNoRecentPendingAppOrder(basics.customerPhone, now);

  const { businesses, deliveryFee } = await resolveCart(businessGroups, now);

  const orderOptions: CreateOrderOptions = {
    guestAccessTokenHash: basics.guestAccessTokenHash,
    destination: basics.destination,
    redemption: basics.redemption,
  };

  return ordersService.createOrder(
    {
      customerName: basics.customerName,
      customerAddress: basics.customerAddress,
      addressReference: basics.addressReference,
      customerPhone: basics.customerPhone,
      deliveryFee,
      clientRequestId: basics.clientRequestId,
      ...(basics.customerId ? { customerId: basics.customerId } : {}),
      source: 'APP',
      businesses,
    },
    undefined,
    orderOptions,
  );
}

export async function createAppOrder(
  customerId: string,
  input: CreateAppOrderInput,
): Promise<OrderDTO> {
  const customer = await customersService.assertCustomerExists(customerId);

  let customerAddress: string;
  let addressReference: string | undefined;
  let savedLocation: { latitude: number | null; longitude: number | null } | null = null;
  if (input.addressId) {
    const address = await addressesRepository.findByIdForCustomer(input.addressId, customerId);
    if (!address) {
      throw new NotFoundError('Dirección no encontrada', 'ADDRESS_NOT_FOUND');
    }
    customerAddress = address.address;
    addressReference = address.reference ?? undefined;
    savedLocation = address;
  } else {
    // El refine del DTO ya garantiza que address venga si no vino addressId.
    customerAddress = input.address as string;
    addressReference = input.addressReference;
  }

  return buildAndCreateOrder(
    {
      customerId,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerAddress,
      addressReference,
      clientRequestId: input.clientRequestId,
      destination: resolveDestination(input.location, savedLocation),
    },
    input.businesses,
  );
}

// Resultado de /checkout: el pedido y, SOLO si fue de invitado, el token con el que ese
// dispositivo podrá seguirlo y valorarlo sin cuenta.
export interface CheckoutResultDTO extends OrderDTO {
  guestAccessToken?: string;
}

// Checkout unificado. Comprar NO exige cuenta:
//  - con authenticatedCustomerId (sale del Bearer verificado, nunca del body) → pedido vinculado
//    a esa cuenta; nombre/teléfono por defecto los de la cuenta.
//  - sin él → invitado: customerId = null, se conservan como snapshot el nombre, teléfono,
//    dirección y referencia que escribió, y se entrega un guestAccessToken.
// Ya NO se vincula un pedido de invitado a un Customer por coincidir el teléfono: escribir un
// número no prueba que sea tuyo, y así se colgaban pedidos en cuentas ajenas.
export async function createCheckoutOrder(
  input: CheckoutOrderInput,
  authenticatedCustomerId?: string,
): Promise<CheckoutResultDTO> {
  if (authenticatedCustomerId) {
    const customer = await customersService.assertCustomerExists(authenticatedCustomerId);

    let customerAddress: string;
    let addressReference: string | undefined;
    let savedLocation: { latitude: number | null; longitude: number | null } | null = null;
    if (input.addressId) {
      const address = await addressesRepository.findByIdForCustomer(input.addressId, customer.id);
      if (!address) {
        throw new NotFoundError('Dirección no encontrada', 'ADDRESS_NOT_FOUND');
      }
      customerAddress = address.address;
      addressReference = address.reference ?? undefined;
      savedLocation = address;
    } else {
      // El refine del DTO garantiza address si no vino addressId.
      customerAddress = input.address as string;
      addressReference = input.addressReference;
    }

    return buildAndCreateOrder(
      {
        customerId: customer.id,
        customerName: input.customerName ?? customer.name,
        customerPhone: input.customerPhone ?? customer.phone,
        customerAddress,
        addressReference,
        clientRequestId: input.clientRequestId,
        destination: resolveDestination(input.location, savedLocation),
        redemption: input.redemption,
      },
      input.businesses,
    );
  }

  // Sin cuenta no hay puntos: un invitado no puede canjear (se rechaza antes de crear nada).
  if (input.redemption) {
    throw new RedemptionError(
      'REDEMPTION_REQUIRES_LOGIN',
      'Inicia sesión para usar tus puntos',
    );
  }

  const missing: string[] = [];
  if (!input.customerName) missing.push('customerName');
  if (!input.customerPhone) missing.push('customerPhone');
  if (!input.address) missing.push('address');
  if (missing.length > 0) {
    throw new BadRequestError(
      'Para pedir sin cuenta indica tu nombre, teléfono y dirección',
      'GUEST_DATA_REQUIRED',
      { missing },
    );
  }
  if (input.addressId) {
    throw new BadRequestError(
      'Las direcciones guardadas requieren iniciar sesión',
      'ADDRESS_ID_REQUIRES_LOGIN',
    );
  }

  const guestAccessToken = createGuestAccessToken(input.clientRequestId);
  const order = await buildAndCreateOrder(
    {
      customerId: null,
      customerName: input.customerName as string,
      customerPhone: input.customerPhone as string,
      customerAddress: input.address as string,
      addressReference: input.addressReference,
      clientRequestId: input.clientRequestId,
      // Un invitado no tiene direcciones guardadas: el pin (si lo puso) viene en este pedido.
      destination: resolveDestination(input.location, null),
      guestAccessTokenHash: hashGuestAccessToken(guestAccessToken),
    },
    input.businesses,
  );

  // El token se entrega solo si es el de ESTE pedido: en un reintento idempotente
  // (mismo clientRequestId) coincide con el guardado y se devuelve el mismo; un pedido
  // anterior a este mecanismo (sin hash) no recibe un token que no abriría nada.
  const storedHash = await ordersService.getGuestAccessTokenHash(order.id);
  return storedHash === hashGuestAccessToken(guestAccessToken)
    ? { ...order, guestAccessToken }
    : order;
}

export async function listCustomerOrders(
  customerId: string,
  query: ListCustomerOrdersQuery,
): Promise<{ data: OrderDTO[]; meta: PaginationMeta }> {
  await customersService.assertCustomerExists(customerId);
  return ordersService.listOrders(
    { page: query.page, pageSize: query.pageSize },
    undefined,
    customerId,
  );
}

// Fase 17: versión liviana de GET /customers/:id/orders/:orderId pensada para polling desde
// la app — solo lo mínimo para actualizar un estado en pantalla, no el pedido completo.
// Aditivo (reseñas/seguimiento): marcas de tiempo de cada transición y el nombre del mensajero
// (el nombre del User; no hay foto ni otros datos). El id del mensajero no se expone.
export interface OrderStatusDTO {
  orderNumber: number;
  status: OrderStatus;
  updatedAt: Date;
  assignedAt: Date | null;
  pickingUpAt: Date | null;
  onTheWayAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  delivererName: string | null;
}

export function toOrderStatusDTO(order: OrderDTO): OrderStatusDTO {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    updatedAt: order.updatedAt,
    assignedAt: order.assignedAt,
    pickingUpAt: order.pickingUpAt,
    onTheWayAt: order.onTheWayAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    delivererName: order.delivererName,
  };
}

// Detalle de UN pedido propio (scopeCustomerId de getOrderById impide leer el de otro cliente).
export async function getCustomerOrder(customerId: string, orderId: string): Promise<OrderDTO> {
  await customersService.assertCustomerExists(customerId);
  return ordersService.getOrderById(orderId, undefined, customerId);
}

export async function getCustomerOrderStatus(
  customerId: string,
  orderId: string,
): Promise<OrderStatusDTO> {
  await customersService.assertCustomerExists(customerId);
  // scopeCustomerId adentro de getOrderById ya garantiza que no se pueda leer un pedido de
  // otro cliente (tira ForbiddenError si no coincide).
  const order = await ordersService.getOrderById(orderId, undefined, customerId);
  return toOrderStatusDTO(order);
}

// Fase 18: reconstruye el carrito de un pedido anterior contra el estado ACTUAL del catálogo
// — nunca reutiliza los precios viejos, y no crea ningún pedido: el cliente confirma de
// nuevo (vía /checkout o /customers/:id/orders) con los valores que devuelve esto.
export interface RepeatOrderItemDTO {
  productId: string | null;
  productName: string;
  quantity: number;
  originalUnitPrice: number;
  currentPrice: number | null;
  available: boolean;
}

export interface RepeatOrderBusinessDTO {
  businessId: string;
  businessName: string;
  isOpenNow: boolean;
  items: RepeatOrderItemDTO[];
}

export interface RepeatOrderResultDTO {
  originalOrderId: string;
  businesses: RepeatOrderBusinessDTO[];
  // true si cualquier negocio/producto ya no está exactamente como en el pedido original
  // (cerrado, agotado, o cambió de precio) — la app debería avisarle al usuario antes de
  // dejarlo confirmar a ciegas.
  hasChanges: boolean;
}

export async function repeatOrder(
  customerId: string,
  orderId: string,
): Promise<RepeatOrderResultDTO> {
  await customersService.assertCustomerExists(customerId);
  const order = await ordersService.getOrderById(orderId, undefined, customerId);

  const now = new Date();
  let hasChanges = false;

  const businesses = await Promise.all(
    order.businesses.map(async (orderBusiness): Promise<RepeatOrderBusinessDTO> => {
      const status = await isBusinessOpen(orderBusiness.businessId, now);
      if (!status.open) {
        hasChanges = true;
      }

      const items = await Promise.all(
        orderBusiness.items
          // Líneas históricas sin productId (texto libre del flujo manual del dashboard) no
          // corresponden a un producto real del catálogo — no se pueden re-agregar al carrito.
          .filter((item) => item.productId !== null)
          .map(async (item): Promise<RepeatOrderItemDTO> => {
            const productId = item.productId as string;
            const product = await productsRepository.findByIdForBusiness(
              productId,
              orderBusiness.businessId,
            );
            const available = product !== null && product.active && product.available;

            let currentPrice: number | null = null;
            if (available && product) {
              const activeOffer = await productOffersRepository.findActiveForProduct(
                productId,
                now,
              );
              const effective = resolveEffectivePrice(product.price, activeOffer);
              currentPrice = effective?.price ?? null;
            }

            if (!available || currentPrice === null || currentPrice !== item.unitPrice) {
              hasChanges = true;
            }

            return {
              productId,
              productName: item.productName,
              quantity: item.quantity,
              originalUnitPrice: item.unitPrice,
              currentPrice,
              available,
            };
          }),
      );

      return {
        businessId: orderBusiness.businessId,
        businessName: orderBusiness.businessName,
        isOpenNow: status.open,
        items,
      };
    }),
  );

  return { originalOrderId: order.id, businesses, hasChanges };
}

/**
 * Cotización de solo lectura del carrito (sin crear ni descontar nada): precios vigentes,
 * delivery, Servicio Tráelo, canje de puntos y total, calculados por el servidor con las mismas
 * reglas que el pedido. La app la muestra para confirmar; NO es una reserva de nada.
 */
export async function quoteCheckout(
  input: CheckoutQuoteInput,
  authenticatedCustomerId?: string,
): Promise<OrderQuoteDTO> {
  const { businesses, deliveryFee } = await resolveCart(input.businesses, new Date());
  return ordersService.quoteOrder(
    { businesses, deliveryFee, customerId: authenticatedCustomerId },
    { redemption: input.redemption },
  );
}

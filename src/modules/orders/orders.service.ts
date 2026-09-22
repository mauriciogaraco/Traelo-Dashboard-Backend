import { NotFoundError, BadRequestError, ConflictError, ForbiddenError } from '../../shared/errors';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import { decimalToNumber } from '../../shared/prisma';
import { resolveDateRange } from '../../shared/date-range';
import { notifyDeliverer } from '../../shared/push';
import { sendTelegramMessage } from '../../shared/telegram';
import { logger } from '../../shared/logger';
import { Prisma } from '../../generated/prisma/client';
import type { CommissionType, OrderSource, OrderStatus } from '../../generated/prisma/enums';
import * as businessesRepository from '../businesses/businesses.repository';
import * as productsRepository from '../businesses/products.repository';
import * as deliverersRepository from '../deliverers/deliverers.repository';
import * as commissionCalculator from '../businesses/commission-calculator';
import * as systemConfigService from '../../config/system-config.service';
import * as customersService from '../customers/customers.service';
import * as customersRepository from '../customers/customers.repository';
import * as pointsService from '../loyalty/points.service';
import * as rewardsRepository from '../loyalty/rewards.repository';
import * as rewardsService from '../loyalty/rewards.service';
import type { RedemptionPlan } from '../loyalty/rewards.rules';
import { releaseLocationIfIdleSafely } from '../tracking/deliverer-location.service';
import { sendPushToCustomer } from '../../shared/push/expo-push';
import { buildStageNotification, type DeliveryStage } from './order-stage-notifications';
import * as ordersRepository from './orders.repository';
import type { OrderWithRelations } from './orders.repository';
import * as calc from './orders.calculations';
import type {
  AssignOrderInput,
  CreateOrderInput,
  ListOrdersQuery,
  UpdateOrderInput,
  UpdateOrderItemsInput,
  UpdateOrderStageInput,
  UpdateOrderStatusInput,
} from './orders.dto';

export interface OrderItemDTO {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  commissionAmount: number;
  /** Empaque elegido (null = sin empaque) y su costo — ya sumado en `subtotal` del negocio, no acá. */
  packagingName: string | null;
  packagingFee: number;
  /** Canje: puntos usados y valor en CUP cubierto por una unidad de esta línea (0 = sin canje). */
  pointsRedeemed: number;
  pointsDiscount: number;
}

export interface OrderBusinessDTO {
  id: string;
  businessId: string;
  businessName: string;
  businessAddress: string;
  subtotal: number;
  commissionEarned: number;
  commissionTypeSnapshot: CommissionType | null;
  commissionRateSnapshot: number | null;
  items: OrderItemDTO[];
}

export interface OrderRedemptionDTO {
  rewardId: string;
  rewardName: string;
  pointsCost: number;
  moneyValue: number;
  status: 'APPLIED' | 'REFUNDED';
}

export interface OrderDTO {
  id: string;
  orderNumber: number;
  customerName: string;
  customerAddress: string;
  addressReference: string | null;
  customerPhone: string;
  deliveryFee: number;
  status: OrderStatus;
  orderDate: Date;
  assignedAt: Date | null;
  acceptedAt: Date | null;
  pickingUpAt: Date | null;
  onTheWayAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  delivererId: string | null;
  delivererName: string | null;
  /** Foto de perfil del mensajero (URL) o null si no tiene. */
  delivererPhotoUrl: string | null;
  registeredByUserId: string | null;
  registeredByName: string | null;
  customerId: string | null;
  source: OrderSource;
  raffleNumber: number | null;
  productsTotal: number; // subtotal de productos — 100% del negocio
  packagingTotal: number; // cuánto de productsTotal es empaque (ya sumado adentro; informativo)
  platformFee: number; // "Servicio Tráelo": cargo visible, redondeado, ganancia de Tráelo
  total: number; // productsTotal - pointsDiscount + deliveryFee + platformFee (lo que paga el cliente)
  pointsDiscount: number; // valor en CUP cubierto con puntos (0 sin canje); no reduce productsTotal
  redemption: OrderRedemptionDTO | null;
  traeloEarning: number; // ganancia total de Tráelo = platformFee + traeloDeliveryShare
  traeloDeliveryShare: number; // parte de Tráelo en la mensajería
  delivererEarning: number;
  businesses: OrderBusinessDTO[];
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(order: OrderWithRelations): OrderDTO {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerAddress: order.customerAddress,
    addressReference: order.addressReference,
    customerPhone: order.customerPhone,
    deliveryFee: decimalToNumber(order.deliveryFee),
    status: order.status,
    orderDate: order.orderDate,
    assignedAt: order.assignedAt,
    acceptedAt: order.acceptedAt,
    pickingUpAt: order.pickingUpAt,
    onTheWayAt: order.onTheWayAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    delivererId: order.delivererId,
    delivererName: order.deliverer?.user.name ?? null,
    delivererPhotoUrl: order.deliverer?.photoUrl ?? null,
    registeredByUserId: order.registeredByUserId,
    registeredByName: order.registeredBy?.name ?? null,
    customerId: order.customerId,
    source: order.source,
    raffleNumber: order.raffleNumber,
    productsTotal: decimalToNumber(order.productsTotal),
    packagingTotal: order.businesses.reduce(
      (sum, ob) => sum + ob.items.reduce((s, item) => s + decimalToNumber(item.packagingFee), 0),
      0,
    ),
    platformFee: decimalToNumber(order.platformFee),
    total: decimalToNumber(order.total),
    pointsDiscount: decimalToNumber(order.pointsDiscount),
    redemption: order.redemption
      ? {
          rewardId: order.redemption.rewardId,
          rewardName: order.redemption.rewardName,
          pointsCost: order.redemption.pointsCost,
          moneyValue: decimalToNumber(order.redemption.moneyValue),
          status: order.redemption.status,
        }
      : null,
    traeloEarning: decimalToNumber(order.traeloEarning),
    traeloDeliveryShare: decimalToNumber(order.traeloDeliveryShare),
    delivererEarning: decimalToNumber(order.delivererEarning),
    businesses: order.businesses.map((ob) => ({
      id: ob.id,
      businessId: ob.businessId,
      // Pedidos anteriores a este cambio no tienen snapshot: se cae al nombre actual del negocio.
      businessName: ob.businessNameSnapshot ?? ob.business.name,
      businessAddress: ob.business.address,
      subtotal: decimalToNumber(ob.subtotal),
      commissionEarned: decimalToNumber(ob.commissionEarned),
      commissionTypeSnapshot: ob.commissionTypeSnapshot,
      commissionRateSnapshot: decimalToNumber(ob.commissionRateSnapshot),
      items: ob.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: decimalToNumber(item.unitPrice),
        subtotal: decimalToNumber(item.subtotal),
        commissionAmount: decimalToNumber(item.commissionAmount),
        packagingName: item.packagingName,
        packagingFee: decimalToNumber(item.packagingFee),
        pointsRedeemed: item.pointsRedeemed,
        pointsDiscount: decimalToNumber(item.pointsDiscount),
      })),
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

// Fase 14, pedido explícito del negocio: evita que un cliente reenvíe pedidos en bucle
// mientras espera respuesta (ha pasado que reenvían y reenvían por no ver confirmación). Solo
// aplica a pedidos de la app (source=APP) — el flujo manual del dashboard nunca lo dispara.
// Se libera solo: cuando pasan REORDER_COOLDOWN_MINUTES, o cuando el staff ya atendió el
// pedido anterior (cambió de PENDING a cualquier otro estado).
const REORDER_COOLDOWN_MINUTES = 20;

export async function assertNoRecentPendingAppOrder(
  customerPhone: string,
  now: Date,
): Promise<void> {
  const cooldownStart = new Date(now.getTime() - REORDER_COOLDOWN_MINUTES * 60_000);
  const recentPending = await ordersRepository.findRecentPendingAppOrderByPhone(
    customerPhone,
    cooldownStart,
  );
  if (!recentPending) {
    return;
  }

  const retryAfterMs =
    recentPending.orderDate.getTime() + REORDER_COOLDOWN_MINUTES * 60_000 - now.getTime();
  const retryAfterMinutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));

  throw new ConflictError(
    `Ya tenés un pedido reciente (#${recentPending.orderNumber}) esperando respuesta. Probá de nuevo en ${retryAfterMinutes} minuto(s).`,
    'RECENT_ORDER_PENDING',
    { orderNumber: recentPending.orderNumber, retryAfterMinutes },
  );
}

// Para que createAppOrder/createCheckoutOrder puedan devolver el mismo pedido en una
// reproducción idempotente sin duplicar el mapeo a DTO (toDTO es privado a este archivo).
export async function getOrderByClientRequestId(clientRequestId: string): Promise<OrderDTO | null> {
  const order = await ordersRepository.findByClientRequestId(clientRequestId);
  return order ? toDTO(order) : null;
}

// Hash del token de acceso de invitado de un pedido (null si no es un pedido de invitado).
// El hash nunca sale en OrderDTO: solo se compara dentro del backend.
export async function getGuestAccessTokenHash(orderId: string): Promise<string | null> {
  const order = await ordersRepository.findById(orderId);
  return order?.guestAccessTokenHash ?? null;
}

// Pedido de invitado a partir del hash de su token (autorización por posesión del token).
export async function findOrderByGuestAccessTokenHash(hash: string): Promise<OrderDTO | null> {
  const order = await ordersRepository.findByGuestAccessTokenHash(hash);
  return order ? toDTO(order) : null;
}

async function resolveEffectivePercentage(deliverer: {
  commissionPercentage: Prisma.Decimal | null;
}): Promise<number> {
  if (deliverer.commissionPercentage !== null) {
    return decimalToNumber(deliverer.commissionPercentage);
  }
  const config = await systemConfigService.getSystemConfig();
  return config.defaultDelivererCommissionPercentage;
}

interface PreparedGroup {
  businessId: string;
  businessNameSnapshot: string;
  subtotal: Prisma.Decimal;
  // Cuánto de `subtotal` es empaque (informativo — ya está sumado adentro de subtotal).
  packagingTotal: Prisma.Decimal;
  commissionEarned: Prisma.Decimal;
  commissionTypeSnapshot: CommissionType;
  commissionRateSnapshot: Prisma.Decimal | null;
  items: (calc.ComputedItemPrice & {
    commissionAmount: Prisma.Decimal;
    pointsRedeemed?: number;
    pointsDiscount?: Prisma.Decimal;
  })[];
}

/**
 * Resuelve precios/comisiones para cada negocio+línea de un pedido. Usado tanto al crear
 * como al reemplazar los productos de un pedido existente — el único lugar que sabe hacer
 * esto, para que ambos flujos calculen exactamente igual.
 */
async function prepareBusinessGroups(
  businessGroups: CreateOrderInput['businesses'],
): Promise<PreparedGroup[]> {
  const preparedGroups: PreparedGroup[] = [];

  for (const group of businessGroups) {
    const business = await businessesRepository.findById(group.businessId);
    if (!business || !business.active) {
      throw new NotFoundError(`Negocio ${group.businessId} no encontrado o inactivo`);
    }

    const items: (calc.ComputedItemPrice & { commissionAmount: Prisma.Decimal })[] = [];
    for (const itemInput of group.items) {
      let product = null;
      if (itemInput.productId) {
        product = await productsRepository.findByIdForBusiness(
          itemInput.productId,
          group.businessId,
        );
        if (!product || !product.active) {
          throw new NotFoundError(
            `Producto ${itemInput.productId} no encontrado o inactivo en el negocio ${group.businessId}`,
          );
        }
      }
      const priced = calc.computeItem(itemInput, product?.name ?? itemInput.productName ?? '');
      const commissionAmount = commissionCalculator.computeLineCommission(
        business,
        product,
        itemInput.quantity,
      );
      items.push({ ...priced, commissionAmount });
    }

    // Base de la comisión: SOLO producto. El empaque (packagingFee) es un costo de material
    // 100% del negocio, nunca ganancia de Tráelo — por eso se suma después, no acá.
    const productSubtotal = items.reduce((acc, item) => acc.plus(item.subtotal), new Prisma.Decimal(0));
    const groupCommission = commissionCalculator.computeGroupCommission(
      business,
      productSubtotal,
      items.map((item) => item.commissionAmount),
    );
    const packagingSubtotal = items.reduce((acc, item) => acc.plus(item.packagingFee), new Prisma.Decimal(0));

    preparedGroups.push({
      businessId: group.businessId,
      businessNameSnapshot: business.name,
      subtotal: productSubtotal.plus(packagingSubtotal),
      packagingTotal: packagingSubtotal,
      commissionEarned: groupCommission.commissionEarned,
      commissionTypeSnapshot: groupCommission.commissionTypeSnapshot,
      commissionRateSnapshot: groupCommission.commissionRateSnapshot,
      items,
    });
  }

  return preparedGroups;
}

function toBusinessesCreateInput(preparedGroups: PreparedGroup[]) {
  return preparedGroups.map((group) => ({
    business: { connect: { id: group.businessId } },
    subtotal: group.subtotal,
    commissionEarned: group.commissionEarned,
    businessNameSnapshot: group.businessNameSnapshot,
    commissionTypeSnapshot: group.commissionTypeSnapshot,
    commissionRateSnapshot: group.commissionRateSnapshot,
    items: {
      create: group.items.map((item) => ({
        ...(item.productId ? { product: { connect: { id: item.productId } } } : {}),
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
        commissionAmount: item.commissionAmount,
        packagingName: item.packagingName,
        packagingFee: item.packagingFee,
        ...(item.pointsRedeemed
          ? { pointsRedeemed: item.pointsRedeemed, pointsDiscount: item.pointsDiscount }
          : {}),
      })),
    },
  }));
}

export interface CreateOrderOptions {
  // Solo pedidos de invitado hechos por /checkout: hash SHA-256 del token que se le entrega al
  // dispositivo para seguir el pedido sin cuenta. No forma parte de CreateOrderInput a
  // propósito: el dashboard (POST /orders) nunca debe poder fijarlo.
  guestAccessTokenHash?: string;
  // Pin de entrega OPCIONAL (snapshot en el pedido, como la dirección). Solo lo fijan los flujos
  // de la app; tampoco forma parte de CreateOrderInput. null/ausente = sin ubicación.
  destination?: { latitude: number; longitude: number } | null;
  // Canje de una recompensa (solo clientes con cuenta; el servidor resuelve costo, precio y saldo).
  redemption?: rewardsService.RedemptionRequest;
}

/** Marca en el grupo la línea que cubre el canje (UNA unidad: su precio efectivo y los puntos). */
function markRedeemedLine(groups: PreparedGroup[], plan: RedemptionPlan): void {
  const group = groups.find((entry) => entry.businessId === plan.businessId);
  const line = group?.items.find((item) => item.productId === plan.productId);
  if (line) {
    line.pointsRedeemed = plan.pointsCost;
    line.pointsDiscount = new Prisma.Decimal(plan.moneyValue);
  }
}

function toCartLines(groups: PreparedGroup[]) {
  return groups.flatMap((group) =>
    group.items.map((item) => ({
      productId: item.productId as string,
      businessId: group.businessId,
      unitPrice: decimalToNumber(item.unitPrice),
    })),
  );
}

export interface OrderQuoteDTO {
  productsTotal: number;
  /** Cuánto de productsTotal es empaque (ya sumado adentro, esto es solo para mostrarlo aparte). */
  packagingTotal: number;
  pointsDiscount: number;
  /** Productos que paga el cliente en dinero: productsTotal - pointsDiscount. */
  productsToPay: number;
  deliveryFee: number;
  platformFee: number;
  total: number;
  redemption:
    | (Pick<RedemptionPlan, 'rewardId' | 'rewardName' | 'pointsCost' | 'balanceBefore' | 'balanceAfter'> & {
        moneyValue: number;
      })
    | null;
}

/**
 * Cotización de solo lectura: los MISMOS cálculos que createOrder (precios, comisiones, Servicio
 * Tráelo, canje) pero sin escribir nada. La app la usa para mostrar el desglose y confirmar; el
 * pedido real vuelve a calcularlo todo.
 */
export async function quoteOrder(
  input: { businesses: CreateOrderInput['businesses']; deliveryFee: number; customerId?: string },
  options: { redemption?: rewardsService.RedemptionRequest } = {},
): Promise<OrderQuoteDTO> {
  const businessIds = input.businesses.map((group) => group.businessId);
  if (new Set(businessIds).size !== businessIds.length) {
    throw new BadRequestError('No se puede repetir el mismo negocio en un pedido');
  }
  const preparedGroups = await prepareBusinessGroups(input.businesses);
  const deliveryFee = new Prisma.Decimal(input.deliveryFee);
  const totals = summarizeGroups(preparedGroups, deliveryFee);

  let plan: RedemptionPlan | null = null;
  if (options.redemption) {
    plan = await rewardsService.resolveRedemptionPlan({
      customerId: input.customerId,
      request: options.redemption,
      lines: toCartLines(preparedGroups),
    });
  }
  const pointsDiscount = new Prisma.Decimal(plan?.moneyValue ?? 0);

  return {
    productsTotal: decimalToNumber(totals.productsTotal),
    packagingTotal: decimalToNumber(totals.packagingTotal),
    pointsDiscount: decimalToNumber(pointsDiscount),
    productsToPay: decimalToNumber(totals.productsTotal.minus(pointsDiscount)),
    deliveryFee: decimalToNumber(deliveryFee),
    platformFee: decimalToNumber(totals.platformFee),
    total: decimalToNumber(totals.productsTotal.minus(pointsDiscount).plus(deliveryFee).plus(totals.platformFee)),
    redemption: plan
      ? {
          rewardId: plan.rewardId,
          rewardName: plan.rewardName,
          pointsCost: plan.pointsCost,
          moneyValue: plan.moneyValue,
          balanceBefore: plan.balanceBefore,
          balanceAfter: plan.balanceAfter,
        }
      : null,
  };
}

function summarizeGroups(groups: PreparedGroup[], deliveryFee: Prisma.Decimal) {
  const subtotal = groups.reduce((acc, group) => acc.plus(group.subtotal), new Prisma.Decimal(0));
  const rawCommissionSum = groups.reduce(
    (acc, group) => acc.plus(group.commissionEarned),
    new Prisma.Decimal(0),
  );
  // Informativo (ya está sumado adentro de productsTotal): cuánto de eso es empaque, para que
  // la app pueda mostrar una línea aparte en vez de esconderlo dentro de "Productos".
  const packagingTotal = groups.reduce((acc, group) => acc.plus(group.packagingTotal), new Prisma.Decimal(0));
  return { ...calc.computeOrderTotals({ subtotal, rawCommissionSum, deliveryFee }), packagingTotal };
}

export async function createOrder(
  input: CreateOrderInput,
  registeredByUserId?: string,
  options: CreateOrderOptions = {},
): Promise<OrderDTO> {
  // Idempotencia (Fase 13): si ya existe un pedido con este clientRequestId, la request es un
  // reintento (mala conexión, timeout, doble tap) — se devuelve el pedido ya creado en vez de
  // duplicarlo. No revalida ni recalcula nada: el primer intento ya es la fuente de verdad.
  if (input.clientRequestId) {
    const existing = await ordersRepository.findByClientRequestId(input.clientRequestId);
    if (existing) {
      return toDTO(existing);
    }
  }

  const businessIds = input.businesses.map((group) => group.businessId);
  if (new Set(businessIds).size !== businessIds.length) {
    throw new BadRequestError('No se puede repetir el mismo negocio en un pedido');
  }

  if (input.customerId) {
    await customersService.assertCustomerExists(input.customerId);
  }

  const preparedGroups = await prepareBusinessGroups(input.businesses);

  const deliveryFee = new Prisma.Decimal(input.deliveryFee);
  const { productsTotal, platformFee: computedPlatformFee } = summarizeGroups(
    preparedGroups,
    deliveryFee,
  );

  // Canje de puntos (solo cliente con cuenta): el servidor valida recompensa, producto y saldo, y
  // marca la línea cubierta. Los puntos solo restan del producto; nunca de mensajería ni Servicio.
  let redemptionPlan: RedemptionPlan | null = null;
  if (options.redemption) {
    redemptionPlan = await rewardsService.resolveRedemptionPlan({
      customerId: input.customerId,
      request: options.redemption,
      lines: toCartLines(preparedGroups),
    });
    markRedeemedLine(preparedGroups, redemptionPlan);
  }
  const pointsDiscount = new Prisma.Decimal(redemptionPlan?.moneyValue ?? 0);
  // El staff puede pedir una excepción puntual (p.ej. 0 cuando no se cobró el servicio en
  // este pedido). El detalle sin redondear por negocio (commissionEarned) no se toca — sigue
  // reflejando lo que cada negocio generó, para que las liquidaciones no pierdan precisión.
  const platformFee =
    input.platformFeeOverride !== undefined
      ? new Prisma.Decimal(input.platformFeeOverride)
      : computedPlatformFee;
  const total = productsTotal.minus(pointsDiscount).plus(deliveryFee).plus(platformFee);

  let order: OrderWithRelations;
  try {
    const orderData: Prisma.OrderCreateInput = {
      customerName: input.customerName,
      customerAddress: input.customerAddress,
      addressReference: input.addressReference,
      ...(options.destination
        ? {
            destinationLatitude: options.destination.latitude,
            destinationLongitude: options.destination.longitude,
          }
        : {}),
      customerPhone: input.customerPhone,
      deliveryFee,
      status: 'PENDING',
      productsTotal,
      platformFee,
      pointsDiscount,
      total,
      // Todavía no hay mensajero asignado: la ganancia de Tráelo por ahora es solo el Servicio Tráelo.
      traeloEarning: platformFee,
      traeloDeliveryShare: new Prisma.Decimal(0),
      delivererEarning: new Prisma.Decimal(0),
      source: input.source ?? 'MANUAL',
      clientRequestId: input.clientRequestId,
      guestAccessTokenHash: options.guestAccessTokenHash,
      raffleNumber: input.raffleNumber,
      ...(registeredByUserId ? { registeredBy: { connect: { id: registeredByUserId } } } : {}),
      ...(input.customerId ? { customer: { connect: { id: input.customerId } } } : {}),
      businesses: {
        create: toBusinessesCreateInput(preparedGroups),
      },
    };
    // Con canje, pedido + redención + descuento de puntos + ledger van en UNA transacción.
    order = redemptionPlan
      ? await rewardsRepository.createOrderWithRedemption({
          orderData,
          customerId: input.customerId as string,
          plan: redemptionPlan,
          divisor: await rewardsService.getPointsDivisor(),
        })
      : await ordersRepository.create(orderData);
  } catch (error) {
    // Carrera: dos requests con el mismo clientRequestId llegaron casi al mismo tiempo y
    // ambas pasaron el chequeo de arriba antes de que la primera terminara de escribir. El
    // unique constraint en DB es la garantía real contra el duplicado — acá solo convertimos
    // ese rechazo en "devolver el pedido que ganó" en vez de un error genérico.
    if (
      input.clientRequestId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await ordersRepository.findByClientRequestId(input.clientRequestId);
      if (existing) {
        return toDTO(existing);
      }
    }
    throw error;
  }

  if (input.customerId) {
    await customersRepository.touchLastOrderAt(input.customerId, order.orderDate);
  }

  let dto = toDTO(order);

  // Despacho automático por cola de mensajeros en línea (app móvil, ver Deliverer.queuedAt): si
  // hay alguien activo, se le asigna este pedido recién creado sin esperar a que el staff lo
  // asigne a mano — y ese mensajero pasa al final de la cola. El staff conserva control total:
  // PATCH /orders/:id/assign sigue funcionando igual para reasignar en cualquier momento. Si la
  // cola está vacía (nadie en línea) o esto falla por lo que sea, el pedido simplemente se
  // queda PENDING para asignación manual — nunca se pierde la creación del pedido por esto.
  const dispatched = await dispatchToQueue(order.id);
  if (dispatched) {
    dto = dispatched;
  }

  // Los pedidos de la app ya NO se envían a Telegram: la base de datos es la fuente de verdad y el
  // dashboard los muestra. (Antes se avisaba al grupo de Telegram por cada pedido que no era manual.)

  return dto;
}

export async function listOrders(
  query: ListOrdersQuery,
  scopeDelivererId?: string,
  scopeCustomerId?: string,
): Promise<{ data: OrderDTO[]; meta: PaginationMeta }> {
  // "range" es el atajo (hoy/semana/mes/...); from/to solo sin range es un rango libre. Si no
  // viene nada de esto, no se filtra por fecha ("todos").
  const dateRange = query.range
    ? resolveDateRange({ range: query.range, from: query.from, to: query.to })
    : query.from || query.to
      ? { from: query.from ?? new Date(0), to: query.to ?? new Date() }
      : null;

  // "Reiniciar historial" (app móvil): solo aplica cuando el propio DELIVERER pregunta por su
  // Historial (COMPLETED/CANCELLED) — nunca al staff/dashboard/cuadres, que siguen viendo el
  // historial completo sin importar qué haya reiniciado cualquier mensajero. Es un filtro de
  // visualización, no borra ni oculta el pedido para nadie más.
  let historyResetWhere: Prisma.OrderWhereInput = {};
  if (scopeDelivererId && (query.status === 'COMPLETED' || query.status === 'CANCELLED')) {
    const deliverer = await deliverersRepository.findById(scopeDelivererId);
    if (deliverer?.historyResetAt) {
      const dateField = query.status === 'COMPLETED' ? 'completedAt' : 'cancelledAt';
      historyResetWhere = { [dateField]: { gte: deliverer.historyResetAt } };
    }
  }

  const where: Prisma.OrderWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.delivererId ? { delivererId: query.delivererId } : {}),
    ...(query.businessId ? { businesses: { some: { businessId: query.businessId } } } : {}),
    ...(query.search ? { customerName: { contains: query.search, mode: 'insensitive' } } : {}),
    ...(dateRange ? { orderDate: { gte: dateRange.from, lte: dateRange.to } } : {}),
    ...(scopeDelivererId ? { delivererId: scopeDelivererId } : {}),
    ...(scopeCustomerId ? { customerId: scopeCustomerId } : {}),
    ...historyResetWhere,
  };

  const { skip, take } = toSkipTake(query);
  const [orders, total] = await Promise.all([
    ordersRepository.findMany(where, skip, take),
    ordersRepository.count(where),
  ]);

  return { data: orders.map(toDTO), meta: buildPaginationMeta(query, total) };
}

export async function getOrderById(
  id: string,
  scopeDelivererId?: string,
  scopeCustomerId?: string,
): Promise<OrderDTO> {
  const order = await ordersRepository.findById(id);
  if (!order) {
    throw new NotFoundError('Pedido no encontrado', 'ORDER_NOT_FOUND');
  }
  if (scopeDelivererId && order.delivererId !== scopeDelivererId) {
    throw new ForbiddenError();
  }
  // Fase 15: un cliente no debe poder consultar un pedido de otro cliente.
  if (scopeCustomerId && order.customerId !== scopeCustomerId) {
    throw new ForbiddenError();
  }
  return toDTO(order);
}

// El mensajero editó los productos de su propio vale desde la app (PATCH /:id/items) — el
// dashboard lee el mismo pedido de Postgres, así que ya "ve" el cambio en su próximo refresh;
// esto es solo para que el staff se entere sin tener que estar refrescando la pantalla. Mismo
// canal operacional que el resto de los avisos internos, nunca la fuente de verdad del pedido.
function formatOrderEditedNotification(order: OrderDTO, previousTotal: number): string {
  const businessNames = order.businesses.map((b) => b.businessName).join(', ') || '—';
  const lines = [
    `✏️ <b>Pedido #${order.orderNumber}</b> editado por el mensajero`,
    `Mensajero: ${order.delivererName ?? '—'}`,
    `Cliente: ${order.customerName} — ${order.customerPhone}`,
    `Negocio(s): ${businessNames}`,
    `Total: $${previousTotal.toFixed(2)} CUP → $${order.total.toFixed(2)} CUP`,
  ];
  return lines.join('\n');
}

export async function updateOrder(
  id: string,
  input: UpdateOrderInput,
  // Un DELIVERER autenticado (PATCH /:id/items, app móvil) solo puede editar sus propios
  // pedidos — el DTO de esa ruta (updateOrderItemsSchema) ya restringe qué campos puede mandar
  // (solo `businesses`), esto es la restricción de ownership que le falta. undefined para
  // staff, sin esta restricción — ver ordersController.resolveDelivererScope.
  scopeDelivererId?: string,
): Promise<OrderDTO> {
  const existing = await ordersRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Pedido no encontrado');
  }
  if (scopeDelivererId && existing.delivererId !== scopeDelivererId) {
    throw new ForbiddenError();
  }
  // Un pedido CANCELLED también se puede editar (corregir datos del cliente, productos o montos):
  // sigue CANCELLED, no genera puntos ni entra a cuadres (solo los COMPLETED lo hacen) y el canje
  // de puntos, si lo tenía, ya fue devuelto (REFUNDED), así que no bloquea el cambio de productos.
  //
  // Un pedido COMPLETED sí se puede editar (p.ej. corregir dirección o productos después de
  // entregado), pero si sus productos/montos ya se usaron para cerrar un cuadre, tocarlos
  // desincronizaría esa liquidación ya cerrada — eso queda bloqueado. Los datos del cliente
  // (nombre, dirección, teléfono) nunca afectan montos, así que siempre se pueden corregir.
  const financialFieldsChanged =
    input.businesses !== undefined ||
    input.deliveryFee !== undefined ||
    input.platformFeeOverride !== undefined;

  if (existing.status === 'COMPLETED' && financialFieldsChanged) {
    const closedSettlementLines = await ordersRepository.countClosedSettlementLines(id);
    if (closedSettlementLines > 0) {
      throw new ConflictError(
        'No se pueden editar productos o montos de un pedido que ya forma parte de un cuadre cerrado',
      );
    }
  }

  // Un canje queda atado a las líneas del pedido: si se cambian los productos, el canje (y el
  // descuento) perdería su sentido. Se cancela el pedido (los puntos vuelven) y se crea otro.
  if (input.businesses !== undefined && existing.redemption?.status === 'APPLIED') {
    throw new ConflictError(
      'Este pedido tiene un canje de puntos: no se pueden cambiar sus productos. Cancélalo (los puntos se devuelven) y crea otro.',
      'ORDER_HAS_REDEMPTION',
    );
  }

  const data: Prisma.OrderUpdateInput = {
    customerName: input.customerName,
    customerAddress: input.customerAddress,
    addressReference: input.addressReference,
    customerPhone: input.customerPhone,
    raffleNumber: input.raffleNumber,
  };

  const itemsChanged = input.businesses !== undefined;
  let productsTotal = new Prisma.Decimal(existing.productsTotal);
  let rawCommissionSum: Prisma.Decimal | null = null;

  if (input.businesses !== undefined) {
    const businessIds = input.businesses.map((group) => group.businessId);
    if (new Set(businessIds).size !== businessIds.length) {
      throw new BadRequestError('No se puede repetir el mismo negocio en un pedido');
    }
    const preparedGroups = await prepareBusinessGroups(input.businesses);
    productsTotal = preparedGroups.reduce(
      (acc, group) => acc.plus(group.subtotal),
      new Prisma.Decimal(0),
    );
    rawCommissionSum = preparedGroups.reduce(
      (acc, group) => acc.plus(group.commissionEarned),
      new Prisma.Decimal(0),
    );
    data.productsTotal = productsTotal;
    // Reemplazo completo: se borran los negocios/items anteriores y se crean los nuevos en la
    // misma escritura de Prisma (atómico), en vez de ir línea por línea tratando de adivinar
    // qué cambió.
    data.businesses = {
      deleteMany: {},
      create: toBusinessesCreateInput(preparedGroups),
    };
  }

  const deliveryFeeChanged = input.deliveryFee !== undefined;
  const platformFeeOverrideChanged = input.platformFeeOverride !== undefined;

  if (deliveryFeeChanged || platformFeeOverrideChanged || itemsChanged) {
    const deliveryFee =
      input.deliveryFee !== undefined
        ? new Prisma.Decimal(input.deliveryFee)
        : new Prisma.Decimal(existing.deliveryFee);

    // Prioridad: una anulación explícita en este mismo pedido de edición siempre gana. Si no
    // se pidió una anulación pero los productos cambiaron, se recalcula el Servicio Tráelo a
    // partir de las comisiones nuevas — de lo contrario queda como estaba.
    let platformFee: Prisma.Decimal;
    if (input.platformFeeOverride !== undefined) {
      platformFee = new Prisma.Decimal(input.platformFeeOverride);
    } else if (itemsChanged) {
      platformFee = calc.roundUpToNearest10(rawCommissionSum ?? new Prisma.Decimal(0));
    } else {
      platformFee = new Prisma.Decimal(existing.platformFee);
    }

    if (deliveryFeeChanged) data.deliveryFee = deliveryFee;
    if (platformFeeOverrideChanged || itemsChanged) data.platformFee = platformFee;
    data.total = productsTotal
      .minus(new Prisma.Decimal(existing.pointsDiscount))
      .plus(deliveryFee)
      .plus(platformFee);

    if (existing.delivererId) {
      const deliverer = await deliverersRepository.findById(existing.delivererId);
      if (deliverer) {
        const effectivePercentage = await resolveEffectivePercentage(deliverer);
        const { delivererShare, traeloDeliveryShare } = calc.computeDeliverySplit(
          deliveryFee,
          effectivePercentage,
        );
        data.delivererEarning = delivererShare;
        data.traeloDeliveryShare = traeloDeliveryShare;
        data.traeloEarning = platformFee.plus(traeloDeliveryShare);
      }
    } else if (platformFeeOverrideChanged || itemsChanged) {
      // Todavía no hay mensajero asignado: la ganancia de Tráelo es solo el Servicio Tráelo.
      data.traeloEarning = platformFee;
    }
  }

  const previousTotal = decimalToNumber(existing.total);
  const order = await ordersRepository.update(id, data);

  // Un pedido COMPLETED corregido en montos puede cambiar sus puntos: se suman o se retiran
  // (con aviso al cliente). Cambios que no tocan el Servicio Tráelo no mueven nada.
  if (existing.status === 'COMPLETED' && financialFieldsChanged) {
    await pointsService.syncOrderPointsSafely(id);
  }
  const dto = toDTO(order);

  // Solo cuando fue el mensajero quien editó (nunca para las propias ediciones del staff desde
  // el dashboard — ya saben lo que cambiaron) y solo si de verdad tocó los productos.
  if (scopeDelivererId && itemsChanged) {
    await sendTelegramMessage(formatOrderEditedNotification(dto, previousTotal));
  }

  // El staff editó el vale de un pedido que ya tiene mensajero — avisarle a él por push (app
  // móvil), nunca cuando fue el propio mensajero quien lo editó (ya lo sabe).
  if (!scopeDelivererId && existing.delivererId) {
    await notifyDeliverer(
      existing.delivererId,
      'Tu vale fue actualizado',
      `El pedido #${dto.orderNumber} tiene cambios — revísalo en la app.`,
      { orderId: dto.id, type: 'ORDER_EDITED' },
    );
  }

  return dto;
}

export async function deleteOrder(id: string): Promise<void> {
  const existing = await ordersRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Pedido no encontrado');
  }
  // Un pedido COMPLETED puede ya formar parte de un cuadre — borrarlo corrompería esa
  // liquidación. Para pedidos completados por error, cancelarlos no es una opción tampoco
  // (mismo motivo); ese caso queda fuera de alcance de este endpoint.
  if (existing.status === 'COMPLETED') {
    throw new ConflictError(
      'No se puede eliminar un pedido COMPLETED — puede formar parte de un cuadre ya generado',
    );
  }
  // Defensivo: por diseño solo los pedidos COMPLETED entran a un cuadre, así que esto no
  // debería dispararse nunca — pero evita un error crudo de FK si esa regla cambia.
  const settlementLines = await ordersRepository.countSettlementLines(id);
  if (settlementLines > 0) {
    throw new ConflictError('No se puede eliminar un pedido que ya forma parte de un cuadre');
  }
  if (existing.redemption?.status === 'APPLIED') {
    await rewardsRepository.removeOrderWithRefund(id);
    return;
  }
  await ordersRepository.remove(id);
}

// Compartido por createOrder (pedido recién creado) y declineOrder (reparto en cascada: ver
// comentario ahí) — intenta asignar `orderId` (debe estar PENDING) al siguiente en la cola de
// despacho automático y lo manda al final de la cola. `excludeDelivererId` sirve para que, al
// re-despachar tras un decline, nunca se le vuelva a ofrecer el mismo pedido a quien recién lo
// rechazó (ver el comentario en deliverersRepository.findNextInQueue). Si no hay nadie en línea,
// o el despacho falla por lo que sea, devuelve null y el pedido se queda como estaba —
// PENDING, para asignación manual — nunca revienta el flujo que lo llama.
async function dispatchToQueue(orderId: string, excludeDelivererId?: string): Promise<OrderDTO | null> {
  try {
    const nextInQueue = await deliverersRepository.findNextInQueue(excludeDelivererId);
    if (!nextInQueue) {
      return null;
    }
    // autoAccept: false — este es el despacho automático por cola (app móvil), NO una asignación
    // de staff: el mensajero todavía tiene que aceptar o declinar (ver accept/declineOrder).
    const dto = await assignOrder(orderId, { delivererId: nextInQueue.id }, { autoAccept: false });
    await deliverersRepository.bumpQueue(nextInQueue.id);
    return dto;
  } catch (error) {
    logger.warn(
      { err: error, orderId },
      'Despacho automático por cola falló — el pedido queda PENDING para asignar a mano',
    );
    return null;
  }
}

export interface AssignOrderOptions {
  // true (default): lo asignó el staff desde el dashboard — el pedido queda aceptado de una
  // (acceptedAt = ahora), el mensajero YA NO puede declinarlo (ver declineOrder: exige
  // !acceptedAt) y solo le llega un aviso informativo. false: despacho automático por cola
  // (dispatchToQueue) — ahí sí hace falta accept/decline explícito del mensajero.
  autoAccept?: boolean;
}

export async function assignOrder(
  id: string,
  input: AssignOrderInput,
  options: AssignOrderOptions = {},
): Promise<OrderDTO> {
  const autoAccept = options.autoAccept ?? true;
  const existing = await ordersRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Pedido no encontrado');
  }
  if (existing.status !== 'PENDING' && existing.status !== 'ASSIGNED') {
    throw new ConflictError('Solo se puede asignar un mensajero a un pedido PENDING o ASSIGNED');
  }

  const deliverer = await deliverersRepository.findById(input.delivererId);
  if (!deliverer) {
    throw new NotFoundError('Mensajero no encontrado');
  }
  if (!deliverer.user.active) {
    throw new BadRequestError('El mensajero no está activo');
  }

  // Reasignación real: ya tenía OTRO mensajero (no el mismo que se le está poniendo de nuevo).
  // Distinto de la primera asignación (previousDelivererId null) — ahí no hay a quién avisarle
  // que se lo "retiraron".
  const previousDelivererId = existing.delivererId;
  const isNewDeliverer = previousDelivererId !== input.delivererId;
  const isReassignment = previousDelivererId !== null && isNewDeliverer;

  const effectivePercentage = await resolveEffectivePercentage(deliverer);
  const { delivererShare, traeloDeliveryShare } = calc.computeDeliverySplit(
    new Prisma.Decimal(existing.deliveryFee),
    effectivePercentage,
  );

  const order = await ordersRepository.update(id, {
    deliverer: { connect: { id: input.delivererId } },
    status: 'ASSIGNED',
    assignedAt: existing.assignedAt ?? new Date(),
    ...(isNewDeliverer
      ? { pickingUpAt: null, onTheWayAt: null, acceptedAt: autoAccept ? new Date() : null }
      : {}),
    traeloEarning: new Prisma.Decimal(existing.platformFee).plus(traeloDeliveryShare),
    traeloDeliveryShare,
    delivererEarning: delivererShare,
  });

  const dto = toDTO(order);

  // Avisa por push (app móvil) — con # de pedido y nombre del cliente siempre. No bloquea la
  // respuesta si no tiene token o el envío falla (notifyDeliverer nunca lanza).
  if (isReassignment && previousDelivererId) {
    await notifyDeliverer(
      previousDelivererId,
      'Pedido reasignado',
      `La administración decidió retirarte el pedido #${dto.orderNumber} (${dto.customerName}) para mejor gestión.`,
      { orderId: dto.id, type: 'ORDER_REASSIGNED_AWAY' },
    );
  }
  await notifyDeliverer(
    input.delivererId,
    'Nuevo pedido asignado',
    `Has recibido el pedido #${dto.orderNumber} (${dto.customerName}).`,
    { orderId: dto.id, type: 'ORDER_ASSIGNED' },
  );

  return dto;
}

/**
 * Etapa del reparto de un pedido ASSIGNED: "Recogiendo" (el mensajero va por el pedido) y luego
 * "En camino" (ya lo lleva al cliente). Solo avanza, en orden y una vez; repetir la misma etapa no
 * hace nada (idempotente). El estado del pedido sigue siendo ASSIGNED. A partir de PICKING_UP el
 * cliente ve el seguimiento en vivo. Un mensajero solo puede mover SUS pedidos (scopeDelivererId).
 */
export async function updateOrderStage(
  id: string,
  input: UpdateOrderStageInput,
  scopeDelivererId?: string,
): Promise<OrderDTO> {
  const existing = await ordersRepository.findById(id);
  if (!existing || (scopeDelivererId !== undefined && existing.delivererId !== scopeDelivererId)) {
    // Un pedido ajeno se ve igual que uno inexistente para el mensajero.
    throw new NotFoundError('Pedido no encontrado');
  }
  if (existing.status !== 'ASSIGNED' || !existing.delivererId) {
    throw new ConflictError(
      'Solo un pedido ASSIGNED con mensajero puede cambiar de etapa',
      'ORDER_NOT_ASSIGNED',
    );
  }

  if (input.stage === 'PICKING_UP') {
    if (existing.pickingUpAt) return toDTO(existing);
    if (existing.onTheWayAt) {
      throw new ConflictError('El pedido ya va en camino', 'STAGE_OUT_OF_ORDER');
    }
    const order = await ordersRepository.update(id, { pickingUpAt: new Date() });
    notifyStageSafely('PICKING_UP', order);
    return toDTO(order);
  }

  // ON_THE_WAY
  if (existing.onTheWayAt) return toDTO(existing);
  if (!existing.pickingUpAt) {
    throw new ConflictError(
      'Primero hay que marcar "Recogiendo" antes de "En camino"',
      'STAGE_OUT_OF_ORDER',
    );
  }
  const order = await ordersRepository.update(id, { onTheWayAt: new Date() });
  notifyStageSafely('ON_THE_WAY', order);
  return toDTO(order);
}

// Push al cliente (solo si tiene cuenta y dispositivo). Sin esperar a Expo y sin poder fallar:
// sendPushToCustomer registra sus errores y nunca lanza, así que la etapa ya guardada no se afecta.
function notifyStageSafely(
  stage: DeliveryStage,
  order: { id: string; orderNumber: number; customerId: string | null },
): void {
  if (!order.customerId) return;
  void sendPushToCustomer(order.customerId, buildStageNotification(stage, order));
}

// Staff conserva la posibilidad de completar (o saltar a cualquier sub-fase) directo desde
// cualquier estado activo (comportamiento previo del dashboard, no depende de que el mensajero
// vaya avanzando el viaje desde la app). El mensajero, en cambio, tiene que recorrer la
// secuencia completa paso a paso, sin saltos: CONFIRMED -> HEADING_OUT -> PICKING_UP ->
// ON_THE_WAY -> COMPLETED — es la app móvil la que exige aceptar antes de confirmar y avanzar
// en orden antes de completar.
const STAFF_STATUS_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PENDING: ['CANCELLED'],
  ASSIGNED: ['CONFIRMED', 'HEADING_OUT', 'PICKING_UP', 'ON_THE_WAY', 'COMPLETED', 'CANCELLED'],
  CONFIRMED: ['HEADING_OUT', 'PICKING_UP', 'ON_THE_WAY', 'COMPLETED', 'CANCELLED'],
  HEADING_OUT: ['PICKING_UP', 'ON_THE_WAY', 'COMPLETED', 'CANCELLED'],
  PICKING_UP: ['ON_THE_WAY', 'COMPLETED', 'CANCELLED'],
  ON_THE_WAY: ['COMPLETED', 'CANCELLED'],
};

const DELIVERER_STATUS_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  ASSIGNED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['HEADING_OUT', 'CANCELLED'],
  HEADING_OUT: ['PICKING_UP', 'CANCELLED'],
  PICKING_UP: ['ON_THE_WAY', 'CANCELLED'],
  ON_THE_WAY: ['COMPLETED', 'CANCELLED'],
};

export async function updateOrderStatus(
  id: string,
  input: UpdateOrderStatusInput,
  // Un DELIVERER autenticado solo puede cambiar el estado de sus propios pedidos
  // asignados (app móvil — ver ordersController.resolveDelivererScope). undefined para staff
  // (OWNER/ADMIN/EMPLOYEE), que no tiene esta restricción.
  scopeDelivererId?: string,
): Promise<OrderDTO> {
  const existing = await ordersRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Pedido no encontrado');
  }
  if (scopeDelivererId && existing.delivererId !== scopeDelivererId) {
    throw new ForbiddenError();
  }

  const transitions = scopeDelivererId ? DELIVERER_STATUS_TRANSITIONS : STAFF_STATUS_TRANSITIONS;
  const allowed = transitions[existing.status] ?? [];
  if (!allowed.includes(input.status)) {
    throw new ConflictError(`No se puede pasar de ${existing.status} a ${input.status}`);
  }

  // El mensajero tiene que aceptar explícitamente (PATCH /:id/accept) antes de poder confirmar
  // — "aceptar" y "confirmar" son dos decisiones separadas suyas, no una sola. Staff se salta
  // esto (no pasa por la app, no hay "aceptar" en el dashboard).
  if (
    scopeDelivererId &&
    existing.status === 'ASSIGNED' &&
    input.status === 'CONFIRMED' &&
    !existing.acceptedAt
  ) {
    throw new ConflictError('Debes aceptar el pedido antes de confirmarlo');
  }

  if (input.status === 'COMPLETED') {
    const order = await ordersRepository.update(id, {
      status: 'COMPLETED',
      completedAt: new Date(),
    });
    // Los puntos se acreditan SOLO al completar (nunca al crear ni al cancelar).
    await pointsService.syncOrderPointsSafely(id);
    // Privacidad: sin más entregas activas, el mensajero deja de tener ubicación guardada.
    await releaseLocationIfIdleSafely(order.delivererId);
    return toDTO(order);
  }

  if (input.status === 'CANCELLED') {
    const cancelData = { status: 'CANCELLED' as const, cancelledAt: new Date() };
    // Con canje aplicado, los puntos vuelven al cliente en la misma transacción que la cancelación.
    const order =
      existing.redemption?.status === 'APPLIED'
        ? await rewardsRepository.cancelOrderWithRefund(id, cancelData)
        : await ordersRepository.update(id, cancelData);
    await releaseLocationIfIdleSafely(order.delivererId);
    return toDTO(order);
  }

  // CONFIRMED/HEADING_OUT/PICKING_UP/ON_THE_WAY: solo cambia el status — salvo PICKING_UP/
  // ON_THE_WAY, que además marcan pickingUpAt/onTheWayAt (el seguimiento en vivo del cliente
  // sigue disparándose de esos timestamps, no del status en sí — ver Order.pickingUpAt).
  const data: Prisma.OrderUpdateInput = { status: input.status };
  if (input.status === 'PICKING_UP' && !existing.pickingUpAt) data.pickingUpAt = new Date();
  if (input.status === 'ON_THE_WAY' && !existing.onTheWayAt) data.onTheWayAt = new Date();

  const order = await ordersRepository.update(id, data);
  if (input.status === 'PICKING_UP' || input.status === 'ON_THE_WAY') {
    notifyStageSafely(input.status, order);
  }
  return toDTO(order);
}

// El mensajero acepta ("se autoasigna") un pedido recién llegado — todavía ASSIGNED, el
// staff ya lo asignó desde el dashboard, delivererId ya es el suyo. Esto NO cambia `status`
// (sigue en ASSIGNED = "Por confirmar"): solo marca `acceptedAt`, que habilita el siguiente
// paso, distinto y posterior, de confirmar (updateOrderStatus, ASSIGNED -> CONFIRMED).
export async function acceptOrder(id: string, scopeDelivererId: string): Promise<OrderDTO> {
  const existing = await ordersRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Pedido no encontrado');
  }
  if (existing.delivererId !== scopeDelivererId) {
    throw new ForbiddenError();
  }
  if (existing.status !== 'ASSIGNED') {
    throw new ConflictError('Solo se puede aceptar un pedido recién asignado (ASSIGNED)');
  }

  const order = await ordersRepository.update(id, { acceptedAt: existing.acceptedAt ?? new Date() });
  return toDTO(order);
}

// Simétrico a assignOrder: el mensajero rechaza un pedido recién asignado. Solo antes de
// aceptar (acceptedAt null) — una vez que aceptó, ya no puede "declinar" (eso sería
// contradictorio con haberlo aceptado), su única salida es cancelar. Vuelve a PENDING sin
// mensajero, y revierte los montos de mensajería que assignOrder había calculado (nadie se
// quedó con esa entrega todavía) — y de ahí, reparto en cascada por la cola de despacho
// automático (brief: "si declina, se le pasa al siguiente en la cola, hasta que alguno lo
// acepte, y si le da la vuelta completa vuelve al primero"): se intenta re-despachar al
// siguiente en línea, excluyendo a quien acaba de declinar (ver dispatchToQueue/
// findNextInQueue). Si nadie más está en línea, o el re-despacho falla, el pedido se queda
// PENDING — listo para que el staff lo reasigne a mano, igual que si nunca hubiera habido cola.
export async function declineOrder(id: string, scopeDelivererId: string): Promise<OrderDTO> {
  const existing = await ordersRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Pedido no encontrado');
  }
  if (existing.delivererId !== scopeDelivererId) {
    throw new ForbiddenError();
  }
  if (existing.status !== 'ASSIGNED') {
    throw new ConflictError('Solo se puede declinar un pedido recién asignado (ASSIGNED)');
  }
  if (existing.acceptedAt) {
    throw new ConflictError('Ya aceptaste este pedido — para no continuar, cancélalo en vez de declinarlo');
  }

  const order = await ordersRepository.update(id, {
    deliverer: { disconnect: true },
    status: 'PENDING',
    assignedAt: null,
    delivererEarning: new Prisma.Decimal(0),
    traeloDeliveryShare: new Prisma.Decimal(0),
    traeloEarning: new Prisma.Decimal(existing.platformFee),
  });

  const redispatched = await dispatchToQueue(id, scopeDelivererId);
  return redispatched ?? toDTO(order);
}

export interface BulkCompleteOrdersDTO {
  completed: OrderDTO[];
  skipped: { id: string; reason: string }[];
}

// Por bulto desde la lista: procesa cada id independientemente en vez de fallar todo el lote
// por un pedido que no esté en ASSIGNED, así el staff puede seleccionar una página entera sin
// tener que separar a mano los que sí están listos.
export async function bulkCompleteOrders(ids: string[]): Promise<BulkCompleteOrdersDTO> {
  const uniqueIds = Array.from(new Set(ids));
  const completed: OrderDTO[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const id of uniqueIds) {
    const existing = await ordersRepository.findById(id);
    if (!existing) {
      skipped.push({ id, reason: 'Pedido no encontrado' });
      continue;
    }
    // Cualquier estado activo previo a COMPLETED/CANCELLED es válido acá — el mensajero puede
    // no haber usado la app en absoluto (se queda en ASSIGNED) o estar en cualquier sub-fase
    // del trayecto; el staff igual puede completarlo directo desde el dashboard.
    const completableStatuses: OrderStatus[] = [
      'ASSIGNED',
      'CONFIRMED',
      'HEADING_OUT',
      'PICKING_UP',
      'ON_THE_WAY',
    ];
    if (!completableStatuses.includes(existing.status)) {
      skipped.push({
        id,
        reason: 'Solo se puede completar un pedido en un estado activo previo a COMPLETED',
      });
      continue;
    }
    const order = await ordersRepository.update(id, {
      status: 'COMPLETED',
      completedAt: new Date(),
    });
    await pointsService.syncOrderPointsSafely(id);
    await releaseLocationIfIdleSafely(order.delivererId);
    completed.push(toDTO(order));
  }

  return { completed, skipped };
}

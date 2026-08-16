import { NotFoundError, BadRequestError, ConflictError, ForbiddenError } from '../../shared/errors';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import { decimalToNumber } from '../../shared/prisma';
import { Prisma } from '../../generated/prisma/client';
import type { CommissionType, OrderStatus } from '../../generated/prisma/enums';
import * as businessesRepository from '../businesses/businesses.repository';
import * as productsRepository from '../businesses/products.repository';
import * as deliverersRepository from '../deliverers/deliverers.repository';
import * as commissionCalculator from '../businesses/commission-calculator';
import * as systemConfigService from '../../config/system-config.service';
import * as ordersRepository from './orders.repository';
import type { OrderWithRelations } from './orders.repository';
import * as calc from './orders.calculations';
import type {
  AssignOrderInput,
  CreateOrderInput,
  ListOrdersQuery,
  UpdateOrderInput,
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
}

export interface OrderBusinessDTO {
  id: string;
  businessId: string;
  businessName: string;
  subtotal: number;
  commissionEarned: number;
  commissionTypeSnapshot: CommissionType | null;
  commissionRateSnapshot: number | null;
  items: OrderItemDTO[];
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
  completedAt: Date | null;
  cancelledAt: Date | null;
  delivererId: string | null;
  delivererName: string | null;
  registeredByUserId: string;
  registeredByName: string;
  productsTotal: number; // subtotal de productos — 100% del negocio
  platformFee: number; // "Servicio Tráelo": cargo visible, redondeado, ganancia de Tráelo
  total: number; // productsTotal + deliveryFee + platformFee
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
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    delivererId: order.delivererId,
    delivererName: order.deliverer?.user.name ?? null,
    registeredByUserId: order.registeredByUserId,
    registeredByName: order.registeredBy.name,
    productsTotal: decimalToNumber(order.productsTotal),
    platformFee: decimalToNumber(order.platformFee),
    total: decimalToNumber(order.total),
    traeloEarning: decimalToNumber(order.traeloEarning),
    traeloDeliveryShare: decimalToNumber(order.traeloDeliveryShare),
    delivererEarning: decimalToNumber(order.delivererEarning),
    businesses: order.businesses.map((ob) => ({
      id: ob.id,
      businessId: ob.businessId,
      // Pedidos anteriores a este cambio no tienen snapshot: se cae al nombre actual del negocio.
      businessName: ob.businessNameSnapshot ?? ob.business.name,
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
      })),
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
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
  commissionEarned: Prisma.Decimal;
  commissionTypeSnapshot: CommissionType;
  commissionRateSnapshot: Prisma.Decimal | null;
  items: (calc.ComputedItemPrice & { commissionAmount: Prisma.Decimal })[];
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

    const subtotal = items.reduce((acc, item) => acc.plus(item.subtotal), new Prisma.Decimal(0));
    const groupCommission = commissionCalculator.computeGroupCommission(
      business,
      subtotal,
      items.map((item) => item.commissionAmount),
    );

    preparedGroups.push({
      businessId: group.businessId,
      businessNameSnapshot: business.name,
      subtotal,
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
      })),
    },
  }));
}

export async function createOrder(
  input: CreateOrderInput,
  registeredByUserId: string,
): Promise<OrderDTO> {
  const businessIds = input.businesses.map((group) => group.businessId);
  if (new Set(businessIds).size !== businessIds.length) {
    throw new BadRequestError('No se puede repetir el mismo negocio en un pedido');
  }

  const preparedGroups = await prepareBusinessGroups(input.businesses);

  const deliveryFee = new Prisma.Decimal(input.deliveryFee);
  const subtotal = preparedGroups.reduce(
    (acc, group) => acc.plus(group.subtotal),
    new Prisma.Decimal(0),
  );
  const rawCommissionSum = preparedGroups.reduce(
    (acc, group) => acc.plus(group.commissionEarned),
    new Prisma.Decimal(0),
  );
  const { productsTotal, platformFee: computedPlatformFee } = calc.computeOrderTotals({
    subtotal,
    rawCommissionSum,
    deliveryFee,
  });
  // El staff puede pedir una excepción puntual (p.ej. 0 cuando no se cobró el servicio en
  // este pedido). El detalle sin redondear por negocio (commissionEarned) no se toca — sigue
  // reflejando lo que cada negocio generó, para que las liquidaciones no pierdan precisión.
  const platformFee =
    input.platformFeeOverride !== undefined
      ? new Prisma.Decimal(input.platformFeeOverride)
      : computedPlatformFee;
  const total = productsTotal.plus(deliveryFee).plus(platformFee);

  const order = await ordersRepository.create({
    customerName: input.customerName,
    customerAddress: input.customerAddress,
    addressReference: input.addressReference,
    customerPhone: input.customerPhone,
    deliveryFee,
    status: 'PENDING',
    productsTotal,
    platformFee,
    total,
    // Todavía no hay mensajero asignado: la ganancia de Tráelo por ahora es solo el Servicio Tráelo.
    traeloEarning: platformFee,
    traeloDeliveryShare: new Prisma.Decimal(0),
    delivererEarning: new Prisma.Decimal(0),
    registeredBy: { connect: { id: registeredByUserId } },
    businesses: {
      create: toBusinessesCreateInput(preparedGroups),
    },
  });

  return toDTO(order);
}

export async function listOrders(
  query: ListOrdersQuery,
  scopeDelivererId?: string,
): Promise<{ data: OrderDTO[]; meta: PaginationMeta }> {
  const where: Prisma.OrderWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.delivererId ? { delivererId: query.delivererId } : {}),
    ...(query.businessId ? { businesses: { some: { businessId: query.businessId } } } : {}),
    ...(query.from || query.to
      ? {
          orderDate: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(scopeDelivererId ? { delivererId: scopeDelivererId } : {}),
  };

  const { skip, take } = toSkipTake(query);
  const [orders, total] = await Promise.all([
    ordersRepository.findMany(where, skip, take),
    ordersRepository.count(where),
  ]);

  return { data: orders.map(toDTO), meta: buildPaginationMeta(query, total) };
}

export async function getOrderById(id: string, scopeDelivererId?: string): Promise<OrderDTO> {
  const order = await ordersRepository.findById(id);
  if (!order) {
    throw new NotFoundError('Pedido no encontrado');
  }
  if (scopeDelivererId && order.delivererId !== scopeDelivererId) {
    throw new ForbiddenError();
  }
  return toDTO(order);
}

export async function updateOrder(id: string, input: UpdateOrderInput): Promise<OrderDTO> {
  const existing = await ordersRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Pedido no encontrado');
  }
  if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
    throw new ConflictError('No se puede editar un pedido COMPLETED o CANCELLED');
  }

  const data: Prisma.OrderUpdateInput = {
    customerName: input.customerName,
    customerAddress: input.customerAddress,
    addressReference: input.addressReference,
    customerPhone: input.customerPhone,
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
    data.total = productsTotal.plus(deliveryFee).plus(platformFee);

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

  const order = await ordersRepository.update(id, data);
  return toDTO(order);
}

export async function assignOrder(id: string, input: AssignOrderInput): Promise<OrderDTO> {
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

  const effectivePercentage = await resolveEffectivePercentage(deliverer);
  const { delivererShare, traeloDeliveryShare } = calc.computeDeliverySplit(
    new Prisma.Decimal(existing.deliveryFee),
    effectivePercentage,
  );

  const order = await ordersRepository.update(id, {
    deliverer: { connect: { id: input.delivererId } },
    status: 'ASSIGNED',
    assignedAt: existing.assignedAt ?? new Date(),
    traeloEarning: new Prisma.Decimal(existing.platformFee).plus(traeloDeliveryShare),
    traeloDeliveryShare,
    delivererEarning: delivererShare,
  });

  return toDTO(order);
}

export async function updateOrderStatus(
  id: string,
  input: UpdateOrderStatusInput,
): Promise<OrderDTO> {
  const existing = await ordersRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Pedido no encontrado');
  }

  if (input.status === 'COMPLETED') {
    if (existing.status !== 'ASSIGNED') {
      throw new ConflictError('Solo se puede completar un pedido en estado ASSIGNED');
    }
    const order = await ordersRepository.update(id, {
      status: 'COMPLETED',
      completedAt: new Date(),
    });
    return toDTO(order);
  }

  if (existing.status !== 'PENDING' && existing.status !== 'ASSIGNED') {
    throw new ConflictError('Solo se puede cancelar un pedido PENDING o ASSIGNED');
  }
  const order = await ordersRepository.update(id, { status: 'CANCELLED', cancelledAt: new Date() });
  return toDTO(order);
}

import { decimalToNumber } from '../../shared/prisma';
import { resolveDateRange } from '../../shared/date-range';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import type { Prisma } from '../../generated/prisma/client';
import type { OrderStatus } from '../../generated/prisma/enums';
import * as businessesService from '../businesses/businesses.service';
import { toOwnerBusinessDTO, type OwnerBusinessDTO } from '../businesses/owner-view';
import * as reportsRepository from '../reports/reports.repository';
import * as portalRepository from './business-portal.repository';
import {
  aggregateRecurringCustomers,
  type RecurringCustomerDTO,
} from './recurring-customers';
import type {
  PortalCustomersQuery,
  PortalOrdersQuery,
  PortalSummaryQuery,
} from './business-portal.dto';

export interface OwnerSummaryDTO {
  // Pedidos creados en el rango (todos los estados) y cuántos terminaron completados/cancelados.
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  completionRate: number;
  // Pedidos en curso ahora mismo (PENDING/ASSIGNED), independiente del rango.
  activeOrders: number;
  // Lo que ESTE negocio vendió (subtotal de sus productos en pedidos completados) — sin
  // mensajería, Servicio Tráelo ni comisiones, que no le corresponden a él.
  salesTotal: number;
  averageTicket: number;
  maxOrder: number;
  topProducts: { productName: string; quantity: number; totalSales: number }[];
}

export interface PortalOrderItemDTO {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface PortalOrderDTO {
  id: string;
  orderNumber: number;
  orderDate: Date;
  completedAt: Date | null;
  status: OrderStatus;
  // Solo el nombre: sin teléfono ni dirección del cliente.
  customerName: string;
  delivererName: string | null;
  items: PortalOrderItemDTO[];
  // Subtotal de los productos de ESTE negocio en el pedido.
  subtotal: number;
}

export async function getMyBusiness(businessId: string): Promise<OwnerBusinessDTO> {
  return toOwnerBusinessDTO(await businessesService.getBusinessById(businessId));
}

export async function getSummary(
  businessId: string,
  query: PortalSummaryQuery,
): Promise<OwnerSummaryDTO> {
  const range = resolveDateRange(query);

  const [byStatus, aggregate, activeOrders, topProducts] = await Promise.all([
    portalRepository.countOrdersByStatus(businessId, range),
    reportsRepository.getBusinessSalesAggregate(businessId, range),
    portalRepository.countActiveOrders(businessId),
    reportsRepository.getTopProductsForBusiness(businessId, range, 10),
  ]);

  const totalOrders = byStatus.reduce((sum, group) => sum + group._count._all, 0);
  const cancelledOrders = byStatus.find((group) => group.status === 'CANCELLED')?._count._all ?? 0;
  const completedOrders = aggregate._count._all;
  const salesTotal = decimalToNumber(aggregate._sum.subtotal) ?? 0;

  return {
    totalOrders,
    completedOrders,
    cancelledOrders,
    completionRate: totalOrders > 0 ? Math.min(100, (completedOrders / totalOrders) * 100) : 0,
    activeOrders,
    salesTotal,
    averageTicket: completedOrders > 0 ? salesTotal / completedOrders : 0,
    maxOrder: decimalToNumber(aggregate._max.subtotal) ?? 0,
    topProducts: topProducts.map((product) => ({
      productName: product.productName,
      quantity: product._sum.quantity ?? 0,
      totalSales: decimalToNumber(product._sum.subtotal) ?? 0,
    })),
  };
}

export async function listOrders(
  businessId: string,
  query: PortalOrdersQuery,
): Promise<{ data: PortalOrderDTO[]; meta: PaginationMeta }> {
  const dateRange = query.range
    ? resolveDateRange({ range: query.range, from: query.from, to: query.to })
    : query.from || query.to
      ? { from: query.from ?? new Date(0), to: query.to ?? new Date() }
      : null;

  const where: Prisma.OrderWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(dateRange ? { orderDate: { gte: dateRange.from, lte: dateRange.to } } : {}),
    ...(query.search ? { customerName: { contains: query.search, mode: 'insensitive' } } : {}),
  };

  const { skip, take } = toSkipTake(query);
  const [orders, total] = await Promise.all([
    portalRepository.findOrders(businessId, where, skip, take),
    portalRepository.countOrders(businessId, where),
  ]);

  const data: PortalOrderDTO[] = orders.map((order) => {
    const businessPart = order.businesses[0];
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      orderDate: order.orderDate,
      completedAt: order.completedAt,
      status: order.status,
      customerName: order.customerName,
      delivererName: order.deliverer?.user.name ?? null,
      items: (businessPart?.items ?? []).map((item) => ({
        id: item.id,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: decimalToNumber(item.unitPrice) ?? 0,
        subtotal: decimalToNumber(item.subtotal) ?? 0,
      })),
      subtotal: decimalToNumber(businessPart?.subtotal ?? null) ?? 0,
    };
  });

  return { data, meta: buildPaginationMeta(query, total) };
}

export async function getRecurringCustomers(
  businessId: string,
  query: PortalCustomersQuery,
): Promise<RecurringCustomerDTO[]> {
  const range = resolveDateRange(query);
  const orders = await portalRepository.findCompletedOrdersForCustomers(businessId, range);

  return aggregateRecurringCustomers(
    orders.map((order) => ({
      customerPhone: order.customerPhone,
      customerName: order.customerName,
      orderDate: order.orderDate,
      businessSubtotal: decimalToNumber(order.businesses[0]?.subtotal ?? null) ?? 0,
    })),
    { minOrders: 2, sortBy: query.sortBy, limit: query.limit },
  );
}

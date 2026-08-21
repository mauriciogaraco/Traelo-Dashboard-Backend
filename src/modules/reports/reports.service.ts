import { decimalToNumber } from '../../shared/prisma';
import { resolveDateRange, type DateRangeQuery } from '../../shared/date-range';
import { NotFoundError } from '../../shared/errors';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import * as businessesRepository from '../businesses/businesses.repository';
import * as deliverersRepository from '../deliverers/deliverers.repository';
import * as reportsRepository from './reports.repository';
import type { ListReportsQuery, TopReportsQuery } from './reports.dto';

export interface SalesReportDTO {
  totalOrders: number;
  completedOrders: number;
  // Ventas PROCESADAS PARA LOS NEGOCIOS (100% suyo) — nunca llamar esto "ventas de Tráelo".
  businessSalesGross: number;
  // Ingreso de Tráelo: "Servicio Tráelo" cobrado en los pedidos.
  platformFeeRevenue: number;
  // Mensajería: total cobrado, parte del mensajero y parte de Tráelo.
  deliveryFeeGross: number;
  delivererShareTotal: number;
  traeloDeliveryShareTotal: number;
  // Ingreso total de Tráelo = platformFeeRevenue + traeloDeliveryShareTotal.
  traeloTotalRevenue: number;
  averageTicket: number;
}

export interface TopBusinessDTO {
  businessId: string;
  businessName: string;
  totalSales: number;
  totalCommission: number;
  orderCount: number;
}

export interface TopDelivererDTO {
  delivererId: string;
  delivererName: string;
  deliveryCount: number;
  totalEarnings: number;
  platformFeeCollected: number;
}

export interface BusinessSalesDetailDTO {
  businessId: string;
  businessName: string;
  totalSales: number;
  totalCommission: number;
  orderCount: number;
  averageSale: number;
  maxSale: number;
  topProducts: {
    productId: string | null;
    productName: string;
    quantitySold: number;
    totalSales: number;
  }[];
}

export async function getSalesReport(query: DateRangeQuery): Promise<SalesReportDTO> {
  const range = resolveDateRange(query);
  const [totalOrders, completedOrders, aggregate] = await Promise.all([
    reportsRepository.countOrders(range),
    reportsRepository.countCompletedOrders(range),
    reportsRepository.aggregateCompletedOrders(range),
  ]);

  const totalCustomerValue = decimalToNumber(aggregate._sum.total) ?? 0;
  const businessSalesGross = decimalToNumber(aggregate._sum.productsTotal) ?? 0;
  const platformFeeRevenue = decimalToNumber(aggregate._sum.platformFee) ?? 0;
  const deliveryFeeGross = decimalToNumber(aggregate._sum.deliveryFee) ?? 0;
  const delivererShareTotal = decimalToNumber(aggregate._sum.delivererEarning) ?? 0;
  const traeloDeliveryShareTotal = decimalToNumber(aggregate._sum.traeloDeliveryShare) ?? 0;

  return {
    totalOrders,
    completedOrders,
    businessSalesGross,
    platformFeeRevenue,
    deliveryFeeGross,
    delivererShareTotal,
    traeloDeliveryShareTotal,
    traeloTotalRevenue: platformFeeRevenue + traeloDeliveryShareTotal,
    averageTicket: completedOrders > 0 ? totalCustomerValue / completedOrders : 0,
  };
}

export async function getTopBusinesses(query: TopReportsQuery): Promise<TopBusinessDTO[]> {
  const range = resolveDateRange(query);
  const grouped = await reportsRepository.topBusinessesByRevenue(range, query.limit);
  if (grouped.length === 0) {
    return [];
  }

  const businesses = await reportsRepository.findBusinessNames(
    grouped.map((group) => group.businessId),
  );
  const nameById = new Map(businesses.map((business) => [business.id, business.name]));

  return grouped.map((group) => ({
    businessId: group.businessId,
    businessName: nameById.get(group.businessId) ?? 'Desconocido',
    totalSales: decimalToNumber(group._sum.subtotal) ?? 0,
    totalCommission: decimalToNumber(group._sum.commissionEarned) ?? 0,
    orderCount: group._count._all,
  }));
}

export async function getTopDeliverers(query: TopReportsQuery): Promise<TopDelivererDTO[]> {
  const range = resolveDateRange(query);
  const grouped = await reportsRepository.topDeliverersByDeliveries(range, query.limit);
  const withDeliverer = grouped.filter(
    (group): group is typeof group & { delivererId: string } => group.delivererId !== null,
  );
  if (withDeliverer.length === 0) {
    return [];
  }

  const deliverers = await reportsRepository.findDelivererNames(
    withDeliverer.map((group) => group.delivererId),
  );
  const nameById = new Map(deliverers.map((deliverer) => [deliverer.id, deliverer.user.name]));

  return withDeliverer.map((group) => ({
    delivererId: group.delivererId,
    delivererName: nameById.get(group.delivererId) ?? 'Desconocido',
    deliveryCount: group._count.id,
    totalEarnings: decimalToNumber(group._sum.delivererEarning) ?? 0,
    platformFeeCollected: decimalToNumber(group._sum.platformFee) ?? 0,
  }));
}

export async function getAllBusinesses(
  query: ListReportsQuery,
): Promise<{ data: TopBusinessDTO[]; meta: PaginationMeta }> {
  const range = resolveDateRange(query);
  const { skip, take } = toSkipTake(query);
  const [grouped, total] = await Promise.all([
    reportsRepository.listBusinessesByRevenue(range, { skip, take, search: query.search }),
    reportsRepository.countBusinessesWithSales(range, query.search),
  ]);

  if (grouped.length === 0) {
    return { data: [], meta: buildPaginationMeta(query, total) };
  }

  const businesses = await reportsRepository.findBusinessNames(grouped.map((group) => group.businessId));
  const nameById = new Map(businesses.map((business) => [business.id, business.name]));

  const data = grouped.map((group) => ({
    businessId: group.businessId,
    businessName: nameById.get(group.businessId) ?? 'Desconocido',
    totalSales: decimalToNumber(group._sum.subtotal) ?? 0,
    totalCommission: decimalToNumber(group._sum.commissionEarned) ?? 0,
    orderCount: group._count._all,
  }));

  return { data, meta: buildPaginationMeta(query, total) };
}

export async function getBusinessSalesDetail(
  businessId: string,
  query: DateRangeQuery,
): Promise<BusinessSalesDetailDTO> {
  const business = await businessesRepository.findById(businessId);
  if (!business) {
    throw new NotFoundError('Negocio no encontrado');
  }

  const range = resolveDateRange(query);
  const [aggregate, topProducts] = await Promise.all([
    reportsRepository.getBusinessSalesAggregate(businessId, range),
    reportsRepository.getTopProductsForBusiness(businessId, range, 10),
  ]);

  const totalSales = decimalToNumber(aggregate._sum.subtotal) ?? 0;
  const orderCount = aggregate._count._all;

  return {
    businessId,
    businessName: business.name,
    totalSales,
    totalCommission: decimalToNumber(aggregate._sum.commissionEarned) ?? 0,
    orderCount,
    averageSale: orderCount > 0 ? totalSales / orderCount : 0,
    maxSale: decimalToNumber(aggregate._max.subtotal) ?? 0,
    topProducts: topProducts.map((product) => ({
      productId: product.productId,
      productName: product.productName,
      quantitySold: product._sum.quantity ?? 0,
      totalSales: decimalToNumber(product._sum.subtotal) ?? 0,
    })),
  };
}

export async function getAllDeliverers(
  query: ListReportsQuery,
): Promise<{ data: TopDelivererDTO[]; meta: PaginationMeta }> {
  const range = resolveDateRange(query);
  const { skip, take } = toSkipTake(query);
  const [grouped, total] = await Promise.all([
    reportsRepository.listDeliverersByDeliveries(range, { skip, take, search: query.search }),
    reportsRepository.countDeliverersWithDeliveries(range, query.search),
  ]);

  const withDeliverer = grouped.filter(
    (group): group is typeof group & { delivererId: string } => group.delivererId !== null,
  );
  if (withDeliverer.length === 0) {
    return { data: [], meta: buildPaginationMeta(query, total) };
  }

  const deliverers = await reportsRepository.findDelivererNames(
    withDeliverer.map((group) => group.delivererId),
  );
  const nameById = new Map(deliverers.map((deliverer) => [deliverer.id, deliverer.user.name]));

  const data = withDeliverer.map((group) => ({
    delivererId: group.delivererId,
    delivererName: nameById.get(group.delivererId) ?? 'Desconocido',
    deliveryCount: group._count.id,
    totalEarnings: decimalToNumber(group._sum.delivererEarning) ?? 0,
    platformFeeCollected: decimalToNumber(group._sum.platformFee) ?? 0,
  }));

  return { data, meta: buildPaginationMeta(query, total) };
}

export interface BusinessDelivererProductDTO {
  productId: string | null;
  productName: string;
  quantity: number;
  totalSales: number;
}

export interface BusinessDelivererBreakdownDTO {
  delivererId: string;
  delivererName: string;
  products: BusinessDelivererProductDTO[];
  totalQuantity: number;
  totalSales: number;
}

export async function getBusinessBreakdownByDeliverer(
  businessId: string,
  query: DateRangeQuery,
): Promise<BusinessDelivererBreakdownDTO[]> {
  const business = await businessesRepository.findById(businessId);
  if (!business) {
    throw new NotFoundError('Negocio no encontrado');
  }

  const range = resolveDateRange(query);
  const orders = await reportsRepository.getBusinessOrdersForDelivererBreakdown(businessId, range);

  const byDeliverer = new Map<
    string,
    { delivererName: string; products: Map<string, BusinessDelivererProductDTO> }
  >();

  for (const order of orders) {
    const delivererId = order.delivererId;
    if (!delivererId) continue;

    let entry = byDeliverer.get(delivererId);
    if (!entry) {
      entry = { delivererName: order.deliverer?.user.name ?? 'Desconocido', products: new Map() };
      byDeliverer.set(delivererId, entry);
    }

    for (const item of order.businesses[0]?.items ?? []) {
      const key = `${item.productId ?? ''}::${item.productName}`;
      const subtotal = decimalToNumber(item.subtotal) ?? 0;
      const existingProduct = entry.products.get(key);
      if (existingProduct) {
        existingProduct.quantity += item.quantity;
        existingProduct.totalSales += subtotal;
      } else {
        entry.products.set(key, {
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          totalSales: subtotal,
        });
      }
    }
  }

  return Array.from(byDeliverer.entries())
    .map(([delivererId, entry]) => {
      const products = Array.from(entry.products.values()).sort((a, b) =>
        a.productName.localeCompare(b.productName),
      );
      return {
        delivererId,
        delivererName: entry.delivererName,
        products,
        totalQuantity: products.reduce((sum, p) => sum + p.quantity, 0),
        totalSales: products.reduce((sum, p) => sum + p.totalSales, 0),
      };
    })
    .sort((a, b) => b.totalSales - a.totalSales);
}

export async function getDelivererSalesDetail(
  delivererId: string,
  query: DateRangeQuery,
): Promise<TopDelivererDTO> {
  const deliverer = await deliverersRepository.findById(delivererId);
  if (!deliverer) {
    throw new NotFoundError('Mensajero no encontrado');
  }

  const range = resolveDateRange(query);
  const aggregate = await reportsRepository.getDelivererSalesAggregate(delivererId, range);

  return {
    delivererId,
    delivererName: deliverer.user.name,
    deliveryCount: aggregate._count._all,
    totalEarnings: decimalToNumber(aggregate._sum.delivererEarning) ?? 0,
    platformFeeCollected: decimalToNumber(aggregate._sum.platformFee) ?? 0,
  };
}

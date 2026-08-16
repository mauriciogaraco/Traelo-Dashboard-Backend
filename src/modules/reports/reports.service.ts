import { decimalToNumber } from '../../shared/prisma';
import { resolveDateRange, type DateRangeQuery } from '../../shared/date-range';
import * as reportsRepository from './reports.repository';
import type { TopReportsQuery } from './reports.dto';

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
  }));
}

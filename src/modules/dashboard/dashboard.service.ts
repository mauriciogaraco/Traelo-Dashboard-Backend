import type { DateRangeQuery } from '../../shared/date-range';
import * as businessesRepository from '../businesses/businesses.repository';
import * as deliverersRepository from '../deliverers/deliverers.repository';
import * as reportsService from '../reports/reports.service';
import type { TopBusinessDTO, TopDelivererDTO } from '../reports/reports.service';

export interface DashboardSummaryDTO {
  totalOrders: number;
  completedOrders: number;
  // Ventas PROCESADAS PARA LOS NEGOCIOS — nunca "ventas de Tráelo".
  businessSalesGross: number;
  platformFeeRevenue: number;
  deliveryFeeGross: number;
  delivererShareTotal: number;
  traeloDeliveryShareTotal: number;
  traeloTotalRevenue: number;
  businessCount: number;
  delivererCount: number;
  averageTicket: number;
  topBusiness: TopBusinessDTO | null;
  topDeliverer: TopDelivererDTO | null;
}

export async function getDashboardSummary(query: DateRangeQuery): Promise<DashboardSummaryDTO> {
  const [sales, topBusinesses, topDeliverers, businessCount, delivererCount] = await Promise.all([
    reportsService.getSalesReport(query),
    reportsService.getTopBusinesses({ ...query, limit: 1 }),
    reportsService.getTopDeliverers({ ...query, limit: 1 }),
    businessesRepository.count({ active: true }),
    deliverersRepository.count({ user: { active: true } }),
  ]);

  return {
    totalOrders: sales.totalOrders,
    completedOrders: sales.completedOrders,
    businessSalesGross: sales.businessSalesGross,
    platformFeeRevenue: sales.platformFeeRevenue,
    deliveryFeeGross: sales.deliveryFeeGross,
    delivererShareTotal: sales.delivererShareTotal,
    traeloDeliveryShareTotal: sales.traeloDeliveryShareTotal,
    traeloTotalRevenue: sales.traeloTotalRevenue,
    businessCount,
    delivererCount,
    averageTicket: sales.averageTicket,
    topBusiness: topBusinesses[0] ?? null,
    topDeliverer: topDeliverers[0] ?? null,
  };
}

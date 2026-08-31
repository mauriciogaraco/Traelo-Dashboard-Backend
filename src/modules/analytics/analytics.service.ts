import { decimalToNumber } from '../../shared/prisma';
import { resolveDateRange } from '../../shared/date-range';
import * as analyticsRepository from './analytics.repository';
import type { AnalyticsQuery, ProductsByHourQuery } from './analytics.dto';

const BUSINESS_TIMEZONE = 'America/Havana';

const hourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  hour: 'numeric',
  hour12: false,
});

// El servidor puede correr en cualquier zona horaria (Render corre en UTC) — la hora que le
// importa al negocio es la hora local de Cuba, no la del proceso. Intl.DateTimeFormat resuelve
// esto con la base de datos ICU que ya trae Node, sin dependencias nuevas.
function getLocalHour(date: Date): number {
  const hour = Number(hourFormatter.format(date));
  return hour === 24 ? 0 : hour;
}

export interface CustomerSegmentationDTO {
  newCustomers: number;
  recurringCustomers: number;
  totalCustomers: number;
  newCustomersRevenue: number;
  recurringCustomersRevenue: number;
}

export async function getCustomerSegmentation(
  query: AnalyticsQuery,
): Promise<CustomerSegmentationDTO> {
  const range = resolveDateRange(query);
  const grouped = await analyticsRepository.getCustomersInRange(range);

  if (grouped.length === 0) {
    return {
      newCustomers: 0,
      recurringCustomers: 0,
      totalCustomers: 0,
      newCustomersRevenue: 0,
      recurringCustomersRevenue: 0,
    };
  }

  const firstOrders = await analyticsRepository.getFirstOrderDates(
    grouped.map((group) => group.customerPhone),
  );
  const firstOrderByPhone = new Map(
    firstOrders.map((row) => [row.customerPhone, row._min.completedAt]),
  );

  let newCustomers = 0;
  let recurringCustomers = 0;
  let newCustomersRevenue = 0;
  let recurringCustomersRevenue = 0;

  for (const group of grouped) {
    const firstOrderDate = firstOrderByPhone.get(group.customerPhone);
    const revenue = decimalToNumber(group._sum.total) ?? 0;
    // "Nuevo" = su primer pedido completado EN LA HISTORIA cayó dentro de este rango — es decir,
    // apareció como cliente durante este periodo. Si ya tenía un pedido antes de que arrancara
    // el rango, es recurrente (haya pedido una o varias veces dentro del rango).
    const isNew = Boolean(firstOrderDate && firstOrderDate >= range.from);
    if (isNew) {
      newCustomers += 1;
      newCustomersRevenue += revenue;
    } else {
      recurringCustomers += 1;
      recurringCustomersRevenue += revenue;
    }
  }

  return {
    newCustomers,
    recurringCustomers,
    totalCustomers: grouped.length,
    newCustomersRevenue,
    recurringCustomersRevenue,
  };
}

export interface DemandByHourDTO {
  hour: number;
  orderCount: number;
  businessSalesGross: number;
}

export async function getDemandByHour(query: AnalyticsQuery): Promise<DemandByHourDTO[]> {
  const range = resolveDateRange(query);
  const orders = await analyticsRepository.getOrdersForDemandByHour(range);

  const buckets: DemandByHourDTO[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orderCount: 0,
    businessSalesGross: 0,
  }));

  for (const order of orders) {
    const hour = getLocalHour(order.orderDate);
    const bucket = buckets[hour];
    if (!bucket) continue;
    bucket.orderCount += 1;
    bucket.businessSalesGross += decimalToNumber(order.total) ?? 0;
  }

  return buckets;
}

export interface ProductByHourDTO {
  businessId: string;
  businessName: string;
  productId: string | null;
  productName: string;
  quantity: number;
  totalSales: number;
}

export async function getProductsByHour(query: ProductsByHourQuery): Promise<ProductByHourDTO[]> {
  const range = resolveDateRange(query);
  const orderBusinesses = await analyticsRepository.getOrderItemsForRange(range);

  const byProduct = new Map<string, ProductByHourDTO>();
  for (const ob of orderBusinesses) {
    if (getLocalHour(ob.order.orderDate) !== query.hour) continue;

    for (const item of ob.items) {
      const key = `${ob.businessId}::${item.productId ?? ''}::${item.productName}`;
      const subtotal = decimalToNumber(item.subtotal) ?? 0;
      const existing = byProduct.get(key);
      if (existing) {
        existing.quantity += item.quantity;
        existing.totalSales += subtotal;
      } else {
        byProduct.set(key, {
          businessId: ob.businessId,
          businessName: ob.business.name,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          totalSales: subtotal,
        });
      }
    }
  }

  return Array.from(byProduct.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, query.limit);
}

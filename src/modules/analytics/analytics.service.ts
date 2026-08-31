import type { Prisma } from '../../generated/prisma/client';
import { decimalToNumber } from '../../shared/prisma';
import { resolveDateRange, startOfBusinessDay } from '../../shared/date-range';
import type { DateRange } from '../../shared/date-range';
import * as analyticsRepository from './analytics.repository';
import type {
  AnalyticsQuery,
  ProductsByHourQuery,
  CustomerTrendQuery,
  RetentionCohortsQuery,
} from './analytics.dto';

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

const monthFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
});

function getMonthKey(date: Date): string {
  const parts = monthFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
}

// monthKey siempre tiene el formato "YYYY-MM" (lo genera getMonthKey), así que los dos
// segmentos del split existen siempre — el `!` documenta esa garantía interna.
function toMonthIndex(monthKey: string): number {
  const [year, month] = monthKey.split('-');
  return Number(year!) * 12 + (Number(month!) - 1);
}

function addMonths(monthKey: string, offset: number): string {
  const total = toMonthIndex(monthKey) + offset;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, '0')}`;
}

function monthDiff(fromKey: string, toKey: string): number {
  return toMonthIndex(toKey) - toMonthIndex(fromKey);
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

export interface CustomerTrendPointDTO {
  date: string; // "2026-08-31", día calendario de La Habana
  newCustomers: number;
  recurringCustomers: number;
  newRevenue: number;
  recurringRevenue: number;
  // % de los clientes de ESE día que ya eran recurrentes — no confundir con el total agregado
  // de getCustomerSegmentation (ese cuenta clientes únicos para todo el rango; acá un mismo
  // cliente puede aparecer varios días si volvió a pedir).
  retentionRate: number;
}

export async function getCustomerTrend(
  query: CustomerTrendQuery,
): Promise<CustomerTrendPointDTO[]> {
  const range = resolveDateRange(query);
  const orders = await analyticsRepository.getCompletedOrdersForTrend(range);

  const firstOrderByPhone = new Map<string, Date | null>();
  if (orders.length > 0) {
    const phones = Array.from(new Set(orders.map((order) => order.customerPhone)));
    const firstOrders = await analyticsRepository.getFirstOrderDates(phones);
    for (const row of firstOrders) firstOrderByPhone.set(row.customerPhone, row._min.completedAt);
  }

  return computeCustomerTrend(orders, firstOrderByPhone, range);
}

export interface CustomerTrendOrder {
  customerPhone: string;
  completedAt: Date | null;
  total: Prisma.Decimal;
}

// Lógica pura (sin acceso a datos) — separada para poder testearla con datos sintéticos, sin
// depender de la base de datos compartida de desarrollo (que tiene tráfico real todo el tiempo).
export function computeCustomerTrend(
  orders: CustomerTrendOrder[],
  firstOrderByPhone: Map<string, Date | null>,
  range: DateRange,
): CustomerTrendPointDTO[] {
  interface DayBucket {
    newCustomers: Set<string>;
    recurringCustomers: Set<string>;
    newRevenue: number;
    recurringRevenue: number;
  }
  const bucketsByKey = new Map<number, DayBucket>();

  for (const order of orders) {
    if (!order.completedAt) continue;
    const key = startOfBusinessDay(order.completedAt).getTime();
    let bucket = bucketsByKey.get(key);
    if (!bucket) {
      bucket = {
        newCustomers: new Set(),
        recurringCustomers: new Set(),
        newRevenue: 0,
        recurringRevenue: 0,
      };
      bucketsByKey.set(key, bucket);
    }
    const firstOrderDate = firstOrderByPhone.get(order.customerPhone);
    const revenue = decimalToNumber(order.total) ?? 0;
    const isNew = Boolean(firstOrderDate && startOfBusinessDay(firstOrderDate).getTime() === key);
    if (isNew) {
      bucket.newCustomers.add(order.customerPhone);
      bucket.newRevenue += revenue;
    } else {
      bucket.recurringCustomers.add(order.customerPhone);
      bucket.recurringRevenue += revenue;
    }
  }

  // Zero-fill de cada día del rango (no solo los que tuvieron pedidos), mismo criterio que
  // los 24 buckets de getDemandByHour, para que el gráfico no tenga huecos.
  const points: CustomerTrendPointDTO[] = [];
  const endKey = startOfBusinessDay(range.to).getTime();
  let cursor = startOfBusinessDay(range.from);
  while (cursor.getTime() <= endKey) {
    const key = cursor.getTime();
    const bucket = bucketsByKey.get(key);
    const newCount = bucket?.newCustomers.size ?? 0;
    const recurringCount = bucket?.recurringCustomers.size ?? 0;
    const total = newCount + recurringCount;
    points.push({
      date: cursor.toISOString().slice(0, 10),
      newCustomers: newCount,
      recurringCustomers: recurringCount,
      newRevenue: bucket?.newRevenue ?? 0,
      recurringRevenue: bucket?.recurringRevenue ?? 0,
      retentionRate: total > 0 ? (recurringCount / total) * 100 : 0,
    });
    // Mismo truco que startOfBusinessIsoWeek: avanzar la fecha UTC un día y renormalizar con
    // startOfBusinessDay da la medianoche siguiente en La Habana (el offset de la zona es
    // constante en el rango de un día, así que esto nunca "salta" un día calendario real).
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = startOfBusinessDay(next);
  }
  return points;
}

export interface RetentionCohortDTO {
  cohortMonth: string; // "2026-03"
  cohortSize: number;
  // % de la cohorte activo en el mes de adquisición+k (índice = k). null = cohorte vacía, sin
  // datos que mostrar para ese mes.
  retention: (number | null)[];
}

export async function getRetentionCohorts(
  query: RetentionCohortsQuery,
): Promise<RetentionCohortDTO[]> {
  const orders = await analyticsRepository.getAllCompletedOrdersForCohorts();
  return computeRetentionCohorts(orders, query.months, new Date());
}

export interface RetentionCohortOrder {
  customerPhone: string;
  completedAt: Date | null;
}

// Lógica pura — mismo motivo que computeCustomerTrend: testeable con datos sintéticos, sin
// depender de la base de datos compartida. `now` se recibe como parámetro (en vez de leer
// `new Date()` adentro) para que los tests puedan fijar "el mes actual" de forma determinista.
export function computeRetentionCohorts(
  orders: RetentionCohortOrder[],
  months: number,
  now: Date,
): RetentionCohortDTO[] {
  const activeMonthsByPhone = new Map<string, Set<string>>();
  for (const order of orders) {
    if (!order.completedAt) continue;
    const monthKey = getMonthKey(order.completedAt);
    let activeMonths = activeMonthsByPhone.get(order.customerPhone);
    if (!activeMonths) {
      activeMonths = new Set();
      activeMonthsByPhone.set(order.customerPhone, activeMonths);
    }
    activeMonths.add(monthKey);
  }

  // Mes de adquisición = el primer mes calendario en que cada cliente apareció.
  const acquisitionMonthByPhone = new Map<string, string>();
  for (const [phone, activeMonths] of activeMonthsByPhone) {
    const first = Array.from(activeMonths).sort()[0];
    if (first) acquisitionMonthByPhone.set(phone, first);
  }

  const currentMonthKey = getMonthKey(now);
  const cohortMonthKeys = Array.from({ length: months }, (_, i) =>
    addMonths(currentMonthKey, -(months - 1 - i)),
  );

  const cohorts: RetentionCohortDTO[] = [];
  for (const cohortMonth of cohortMonthKeys) {
    const cohortPhones = Array.from(acquisitionMonthByPhone.entries())
      .filter(([, month]) => month === cohortMonth)
      .map(([phone]) => phone);

    const monthsElapsed = monthDiff(cohortMonth, currentMonthKey);
    const retention: (number | null)[] = [];
    for (let k = 0; k <= monthsElapsed; k += 1) {
      if (cohortPhones.length === 0) {
        retention.push(null);
        continue;
      }
      const targetMonth = addMonths(cohortMonth, k);
      const activeCount = cohortPhones.filter((phone) =>
        activeMonthsByPhone.get(phone)?.has(targetMonth),
      ).length;
      retention.push((activeCount / cohortPhones.length) * 100);
    }

    cohorts.push({ cohortMonth, cohortSize: cohortPhones.length, retention });
  }

  return cohorts;
}

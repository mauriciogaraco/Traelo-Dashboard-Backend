import { prisma } from '../../shared/prisma';
import type { DateRange } from '../../shared/date-range';

export function getCustomersInRange(range: DateRange) {
  return prisma.order.groupBy({
    by: ['customerPhone'],
    where: { status: 'COMPLETED', completedAt: { gte: range.from, lte: range.to } },
    _count: { _all: true },
    _sum: { total: true },
  });
}

// Sin filtro de rango a propósito: necesitamos la fecha de su primer pedido en TODA la
// historia para saber si "nació" como cliente dentro del rango consultado o ya existía antes.
export function getFirstOrderDates(customerPhones: string[]) {
  return prisma.order.groupBy({
    by: ['customerPhone'],
    where: { status: 'COMPLETED', customerPhone: { in: customerPhones } },
    _min: { completedAt: true },
  });
}

// No se cuenta CANCELLED como demanda real (el pedido nunca se concretó).
export function getOrdersForDemandByHour(range: DateRange) {
  return prisma.order.findMany({
    where: { orderDate: { gte: range.from, lte: range.to }, status: { not: 'CANCELLED' } },
    select: { orderDate: true, total: true },
  });
}

export interface OrdersTrendMonthlyRow {
  month: string;
  order_count: number;
  sales_gross: number;
}

// Para Semestre/Año (granularidad mensual) traer cada pedido crudo con findMany y sumar en JS
// no escala — un año son decenas de miles de filas y termina en timeout de Prisma/Postgres
// (P2039) antes de que Node llegue a agrupar nada. Se agrega directamente en Postgres, que
// devuelve ~6-12 filas ya sumadas.
//
// "orderDate" es TIMESTAMP(3) sin huso horario, guardado como el instante UTC "pelado" (así
// escribe Prisma cualquier Date de JS) — por eso hace falta el doble AT TIME ZONE: la primera
// conversión (a 'UTC') lo reinterpreta como el timestamptz real, la segunda (a
// 'America/Havana') lo pasa a la hora de pared de La Habana para truncar el mes ahí, no en UTC.
export function getOrdersTrendMonthlyAggregate(range: DateRange): Promise<OrdersTrendMonthlyRow[]> {
  return prisma.$queryRaw<OrdersTrendMonthlyRow[]>`
    SELECT
      to_char(
        date_trunc('month', "orderDate" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Havana'),
        'YYYY-MM'
      ) AS month,
      COUNT(*)::int AS order_count,
      COALESCE(SUM("total"), 0)::float8 AS sales_gross
    FROM "orders"
    WHERE "orderDate" >= ${range.from} AND "orderDate" <= ${range.to} AND status != 'CANCELLED'
    GROUP BY 1
    ORDER BY 1
  `;
}

// Trae cada pedido completado del rango con su cliente y fecha — se agrupa por día
// calendario (hora de La Habana) en el service, mismo estilo que getOrdersForDemandByHour.
export function getCompletedOrdersForTrend(range: DateRange) {
  return prisma.order.findMany({
    where: { status: 'COMPLETED', completedAt: { gte: range.from, lte: range.to } },
    select: { customerPhone: true, completedAt: true, total: true },
  });
}

// Todo el historial de pedidos completados, sin filtro de rango — una cohorte de
// adquisición necesita saber en qué meses posteriores volvió cada cliente, sin importar
// qué rango esté seleccionado en la página.
export function getAllCompletedOrdersForCohorts() {
  return prisma.order.findMany({
    where: { status: 'COMPLETED' },
    select: { customerPhone: true, completedAt: true },
  });
}

// La hora del día no es una columna — se trae cada línea vendida en el rango (con la fecha del
// pedido) y se filtra/agrupa por hora en el service, mismo estilo que
// reports.repository.ts#getOrderItemsForTopProducts.
export function getOrderItemsForRange(range: DateRange) {
  return prisma.orderBusiness.findMany({
    where: {
      order: { orderDate: { gte: range.from, lte: range.to }, status: { not: 'CANCELLED' } },
    },
    select: {
      businessId: true,
      business: { select: { name: true } },
      order: { select: { orderDate: true } },
      items: {
        select: { productId: true, productName: true, quantity: true, subtotal: true },
      },
    },
  });
}

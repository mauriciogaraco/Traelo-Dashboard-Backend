export interface CustomerOrderRow {
  // Solo se usa como llave de agrupación en el servidor: NUNCA sale en la respuesta al dueño
  // del negocio (el teléfono del cliente no se le muestra).
  customerPhone: string;
  customerName: string;
  orderDate: Date;
  // Lo que este negocio vendió en el pedido (su subtotal), no el total que pagó el cliente.
  businessSubtotal: number;
}

export interface RecurringCustomerDTO {
  customerName: string;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: Date;
}

export type RecurringCustomerSortBy = 'orderCount' | 'totalSpent' | 'lastOrder';

/**
 * Agrupa los pedidos completados de UN negocio por cliente y devuelve solo los recurrentes
 * (`minOrders` o más pedidos). El nombre mostrado es el del pedido más reciente, porque puede
 * variar levemente entre pedidos del mismo teléfono.
 */
export function aggregateRecurringCustomers(
  rows: CustomerOrderRow[],
  opts: { minOrders: number; sortBy: RecurringCustomerSortBy; limit: number },
): RecurringCustomerDTO[] {
  const byPhone = new Map<string, RecurringCustomerDTO & { latestAt: number }>();

  for (const row of rows) {
    const rowTime = row.orderDate.getTime();
    const existing = byPhone.get(row.customerPhone);

    if (!existing) {
      byPhone.set(row.customerPhone, {
        customerName: row.customerName,
        orderCount: 1,
        totalSpent: row.businessSubtotal,
        lastOrderAt: row.orderDate,
        latestAt: rowTime,
      });
      continue;
    }

    existing.orderCount += 1;
    existing.totalSpent += row.businessSubtotal;
    if (rowTime > existing.latestAt) {
      existing.latestAt = rowTime;
      existing.lastOrderAt = row.orderDate;
      existing.customerName = row.customerName;
    }
  }

  const sorters: Record<RecurringCustomerSortBy, (a: RecurringCustomerDTO, b: RecurringCustomerDTO) => number> =
    {
      orderCount: (a, b) => b.orderCount - a.orderCount || b.totalSpent - a.totalSpent,
      totalSpent: (a, b) => b.totalSpent - a.totalSpent || b.orderCount - a.orderCount,
      lastOrder: (a, b) => b.lastOrderAt.getTime() - a.lastOrderAt.getTime(),
    };

  return Array.from(byPhone.values())
    .filter((customer) => customer.orderCount >= opts.minOrders)
    .map(({ latestAt: _latestAt, ...customer }) => customer)
    .sort(sorters[opts.sortBy])
    .slice(0, opts.limit);
}

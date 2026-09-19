import { describe, expect, it } from 'vitest';
import { aggregateRecurringCustomers, type CustomerOrderRow } from './recurring-customers';

function row(phone: string, name: string, day: number, subtotal: number): CustomerOrderRow {
  return {
    customerPhone: phone,
    customerName: name,
    orderDate: new Date(Date.UTC(2026, 8, day, 15, 0, 0)),
    businessSubtotal: subtotal,
  };
}

const opts = { minOrders: 2, sortBy: 'orderCount', limit: 20 } as const;

describe('aggregateRecurringCustomers', () => {
  it('solo devuelve clientes con minOrders o más pedidos', () => {
    const result = aggregateRecurringCustomers(
      [row('111', 'Ana', 1, 500), row('111', 'Ana', 2, 700), row('222', 'Luis', 3, 900)],
      opts,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ customerName: 'Ana', orderCount: 2, totalSpent: 1200 });
  });

  it('agrupa por teléfono y usa el nombre del pedido más reciente', () => {
    const result = aggregateRecurringCustomers(
      [row('111', 'Ana P', 1, 100), row('111', 'Ana Pérez', 5, 100)],
      opts,
    );
    expect(result[0]?.customerName).toBe('Ana Pérez');
    expect(result[0]?.lastOrderAt.getUTCDate()).toBe(5);
  });

  it('nunca expone el teléfono del cliente en el resultado', () => {
    const result = aggregateRecurringCustomers([row('55512345', 'Ana', 1, 1), row('55512345', 'Ana', 2, 1)], opts);
    expect(JSON.stringify(result)).not.toContain('55512345');
    expect(Object.keys(result[0] ?? {}).sort()).toEqual(['customerName', 'lastOrderAt', 'orderCount', 'totalSpent']);
  });

  it('ordena por gasto o por último pedido según sortBy', () => {
    const rows = [
      row('111', 'Ana', 1, 100),
      row('111', 'Ana', 2, 100),
      row('222', 'Luis', 3, 5000),
      row('222', 'Luis', 9, 5000),
      row('333', 'Sara', 4, 10),
      row('333', 'Sara', 20, 10),
    ];
    expect(aggregateRecurringCustomers(rows, { ...opts, sortBy: 'totalSpent' })[0]?.customerName).toBe('Luis');
    expect(aggregateRecurringCustomers(rows, { ...opts, sortBy: 'lastOrder' })[0]?.customerName).toBe('Sara');
  });

  it('respeta el límite', () => {
    const rows = ['1', '2', '3'].flatMap((p) => [row(p, `C${p}`, 1, 1), row(p, `C${p}`, 2, 1)]);
    expect(aggregateRecurringCustomers(rows, { ...opts, limit: 2 })).toHaveLength(2);
  });
});

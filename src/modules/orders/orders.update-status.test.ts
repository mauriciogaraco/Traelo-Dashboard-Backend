// Qué estados de pedido se pueden editar. Repositorios y servicios vecinos van mockeados: solo se
// prueba la regla de updateOrder (la escritura real contra la base está en los tests de integración).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
  countClosedSettlementLines: vi.fn(),
}));
const points = vi.hoisted(() => ({ syncOrderPointsSafely: vi.fn() }));

vi.mock('./orders.repository', () => repo);
vi.mock('../loyalty/points.service', () => points);
vi.mock('../../shared/prisma', () => ({ decimalToNumber: (value: unknown) => Number(value) }));
vi.mock('../businesses/businesses.repository', () => ({}));
vi.mock('../businesses/products.repository', () => ({}));
vi.mock('../deliverers/deliverers.repository', () => ({ findById: vi.fn() }));
vi.mock('../businesses/commission-calculator', () => ({}));
vi.mock('../../config/system-config.service', () => ({}));
vi.mock('../customers/customers.service', () => ({}));
vi.mock('../customers/customers.repository', () => ({}));
vi.mock('../loyalty/rewards.repository', () => ({}));
vi.mock('../loyalty/rewards.service', () => ({}));
vi.mock('../tracking/deliverer-location.service', () => ({
  releaseLocationIfIdleSafely: vi.fn(),
}));

import * as service from './orders.service';

const order = (status: string, overrides: Record<string, unknown> = {}) => ({
  id: 'o1',
  orderNumber: 1234,
  customerName: 'Ana',
  customerAddress: 'Calle 1',
  addressReference: null,
  customerPhone: '55555555',
  deliveryFee: 250,
  status,
  orderDate: new Date('2026-09-20T12:00:00Z'),
  assignedAt: null,
  completedAt: status === 'COMPLETED' ? new Date('2026-09-20T13:00:00Z') : null,
  cancelledAt: status === 'CANCELLED' ? new Date('2026-09-20T13:00:00Z') : null,
  delivererId: null,
  deliverer: null,
  registeredByUserId: null,
  registeredBy: null,
  customerId: null,
  source: 'MANUAL',
  raffleNumber: null,
  productsTotal: 1000,
  platformFee: 50,
  total: 1300,
  pointsDiscount: 0,
  redemption: null,
  traeloEarning: 50,
  traeloDeliveryShare: 0,
  delivererEarning: 0,
  businesses: [],
  createdAt: new Date('2026-09-20T12:00:00Z'),
  updatedAt: new Date('2026-09-20T12:00:00Z'),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  repo.countClosedSettlementLines.mockResolvedValue(0);
});

describe('updateOrder según el estado del pedido', () => {
  it('permite editar un pedido CANCELLED: guarda los datos y sigue cancelado', async () => {
    repo.findById.mockResolvedValue(order('CANCELLED'));
    repo.update.mockResolvedValue(order('CANCELLED', { customerName: 'Ana María' }));

    const result = await service.updateOrder('o1', { customerName: 'Ana María' });

    expect(repo.update).toHaveBeenCalledWith('o1', expect.objectContaining({ customerName: 'Ana María' }));
    expect(result.status).toBe('CANCELLED');
    expect(result.customerName).toBe('Ana María');
    // Un pedido cancelado no genera puntos: no se sincronizan.
    expect(points.syncOrderPointsSafely).not.toHaveBeenCalled();
  });

  it('un pedido CANCELLED admite cambiar montos sin consultar cuadres (nunca los tuvo)', async () => {
    repo.findById.mockResolvedValue(order('CANCELLED'));
    repo.update.mockResolvedValue(order('CANCELLED', { deliveryFee: 300 }));

    await service.updateOrder('o1', { deliveryFee: 300 });

    expect(repo.countClosedSettlementLines).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();
  });

  it('un pedido COMPLETED sigue editable en datos del cliente', async () => {
    repo.findById.mockResolvedValue(order('COMPLETED'));
    repo.update.mockResolvedValue(order('COMPLETED', { customerAddress: 'Calle 2' }));

    const result = await service.updateOrder('o1', { customerAddress: 'Calle 2' });

    expect(result.customerAddress).toBe('Calle 2');
  });

  it('un pedido COMPLETED en un cuadre cerrado sigue sin permitir cambiar montos', async () => {
    repo.findById.mockResolvedValue(order('COMPLETED'));
    repo.countClosedSettlementLines.mockResolvedValue(1);

    await expect(service.updateOrder('o1', { deliveryFee: 300 })).rejects.toThrow(/cuadre cerrado/);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('un pedido inexistente da 404', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.updateOrder('nope', { customerName: 'X' })).rejects.toThrow(/no encontrado/i);
  });
});

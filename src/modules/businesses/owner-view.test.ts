import { describe, expect, it } from 'vitest';
import { toOwnerBusinessDTO, toOwnerProductDTO } from './owner-view';
import type { BusinessDTO } from './businesses.service';
import type { ProductDTO } from './products.service';

const business: BusinessDTO = {
  id: 'b1',
  name: 'Cronos',
  phone: '555',
  address: 'Calle 1',
  joinedAt: new Date('2026-01-01'),
  active: true,
  acceptingOrders: true,
  commissionType: 'PERCENTAGE',
  commissionPercentage: 5,
  defaultProductCommissionAmount: 30,
  deliveryFeeBase: 350,
  logoUrl: null,
  logoBlurhash: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('vista de dueño de negocio', () => {
  it('el negocio nunca incluye comisión ni tarifa de envío base', () => {
    const dto = toOwnerBusinessDTO(business);
    const serialized = JSON.stringify(dto);
    for (const leaked of ['commission', 'deliveryFeeBase', 'currentSubscription']) {
      expect(serialized).not.toContain(leaked);
    }
    expect(dto).toMatchObject({ id: 'b1', name: 'Cronos', acceptingOrders: true });
  });

  it('el producto conserva sus datos pero pierde la comisión', () => {
    const product: ProductDTO = {
      id: 'p1',
      businessId: 'b1',
      name: 'Cronos de Oreo',
      description: null,
      category: null,
      categoryId: null,
      price: 900,
      active: true,
      available: true,
      lowStock: false,
      externalId: null,
      imageUrl: null,
      imageBlurhash: null,
      packaging: null,
      commission: { commissionAmount: 40 },
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    };
    const dto = toOwnerProductDTO(product);
    expect(dto.commission).toBeNull();
    expect(dto).toMatchObject({ name: 'Cronos de Oreo', price: 900 });
  });
});

import { describe, expect, it } from 'vitest';
import { packagingSchema, parsePackaging } from './packaging';

describe('packagingSchema', () => {
  it('acepta opciones válidas, con precio 0, precio como texto y capacidad opcional', () => {
    expect(
      packagingSchema.parse([
        { name: 'Caja', price: 50, capacity: 4 },
        { name: 'Sin caja', price: '0' },
      ]),
    ).toEqual([
      { name: 'Caja', price: 50, capacity: 4 },
      { name: 'Sin caja', price: 0 },
    ]);
  });

  it('es flexible con null, vacío, objeto suelto, texto JSON y entradas null', () => {
    expect(packagingSchema.parse(null)).toEqual([]);
    expect(packagingSchema.parse('')).toEqual([]);
    expect(packagingSchema.parse({ name: 'Caja', price: 10 })).toEqual([{ name: 'Caja', price: 10 }]);
    expect(packagingSchema.parse('[{"name":"Jaba","price":"20"}]')).toEqual([{ name: 'Jaba', price: 20 }]);
    expect(packagingSchema.parse([null, { name: 'Caja', price: 10, capacity: null }])).toEqual([
      { name: 'Caja', price: 10 },
    ]);
    expect(packagingSchema.parse([{ name: 'Caja', price: 10, capacity: '' }])).toEqual([{ name: 'Caja', price: 10 }]);
  });

  it('encaja como campo opcional y nullable de un DTO', async () => {
    const { z } = await import('zod');
    const dto = z.object({ packaging: packagingSchema.nullable().optional() });
    expect(dto.parse({})).toEqual({});
    expect(dto.parse({ packaging: null })).toEqual({ packaging: null });
    expect(dto.parse({ packaging: [] })).toEqual({ packaging: [] });
  });

  it('rechaza precios negativos, nombres vacíos, capacidad no entera, repetidos y más de 10', () => {
    expect(packagingSchema.safeParse([{ name: 'Caja', price: -1 }]).success).toBe(false);
    expect(packagingSchema.safeParse([{ name: '  ', price: 1 }]).success).toBe(false);
    expect(packagingSchema.safeParse([{ name: 'Caja', price: 1, capacity: 1.5 }]).success).toBe(false);
    expect(
      packagingSchema.safeParse([
        { name: 'Caja', price: 1 },
        { name: 'caja', price: 2 },
      ]).success,
    ).toBe(false);
    expect(packagingSchema.safeParse(Array.from({ length: 11 }, (_, i) => ({ name: `E${i}`, price: 1 }))).success).toBe(false);
    expect(packagingSchema.safeParse('basura').success).toBe(false);
  });
});

describe('parsePackaging', () => {
  it('devuelve null para null, vacío o datos irreconocibles sin lanzar', () => {
    expect(parsePackaging(null)).toBeNull();
    expect(parsePackaging(undefined)).toBeNull();
    expect(parsePackaging([])).toBeNull();
    expect(parsePackaging('basura')).toBeNull();
    expect(parsePackaging(42)).toBeNull();
    expect(parsePackaging([{ name: 'x' }])).toBeNull();
  });

  it('conserva las opciones válidas y descarta las inválidas o repetidas', () => {
    expect(
      parsePackaging([
        { name: 'Termopack', price: 200 },
        { name: 'Roto' },
        { name: 'termopack', price: 5 },
        null,
      ]),
    ).toEqual([{ name: 'Termopack', price: 200 }]);
  });
});

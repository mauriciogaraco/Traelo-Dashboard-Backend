import { describe, expect, it } from 'vitest';
import { packagingSchema, parsePackaging } from './packaging';

describe('packagingSchema', () => {
  it('acepta opciones válidas, con precio 0 y capacidad opcional', () => {
    const result = packagingSchema.parse([
      { name: 'Caja', price: 50, capacity: 4 },
      { name: 'Sin caja', price: '0' },
    ]);
    expect(result).toEqual([
      { name: 'Caja', price: 50, capacity: 4 },
      { name: 'Sin caja', price: 0 },
    ]);
  });

  it('rechaza precios negativos, nombres vacíos, capacidad no entera y nombres repetidos', () => {
    expect(packagingSchema.safeParse([{ name: 'Caja', price: -1 }]).success).toBe(false);
    expect(packagingSchema.safeParse([{ name: '  ', price: 1 }]).success).toBe(false);
    expect(packagingSchema.safeParse([{ name: 'Caja', price: 1, capacity: 1.5 }]).success).toBe(false);
    expect(
      packagingSchema.safeParse([
        { name: 'Caja', price: 1 },
        { name: 'caja', price: 2 },
      ]).success,
    ).toBe(false);
  });

  it('limita a 10 opciones', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ name: `E${i}`, price: 1 }));
    expect(packagingSchema.safeParse(many).success).toBe(false);
  });
});

describe('parsePackaging', () => {
  it('devuelve null para null, vacío o datos inválidos en vez de lanzar', () => {
    expect(parsePackaging(null)).toBeNull();
    expect(parsePackaging([])).toBeNull();
    expect(parsePackaging('basura')).toBeNull();
    expect(parsePackaging([{ name: 'x' }])).toBeNull();
  });

  it('devuelve las opciones válidas', () => {
    expect(parsePackaging([{ name: 'Termopack', price: 200 }])).toEqual([{ name: 'Termopack', price: 200 }]);
  });
});

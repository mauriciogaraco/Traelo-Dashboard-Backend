import { describe, expect, it } from 'vitest';
import { listProductsQuerySchema } from './products.dto';

describe('listProductsQuerySchema · search', () => {
  it('acepta un texto de búsqueda y le quita espacios', () => {
    expect(listProductsQuerySchema.parse({ search: '  oreo ' }).search).toBe('oreo');
  });

  it('vacío o solo espacios equivale a no filtrar (no es un error)', () => {
    expect(listProductsQuerySchema.parse({ search: '' }).search).toBeUndefined();
    expect(listProductsQuerySchema.parse({ search: '   ' }).search).toBeUndefined();
    expect(listProductsQuerySchema.parse({}).search).toBeUndefined();
  });

  it('rechaza búsquedas de más de 120 caracteres', () => {
    expect(listProductsQuerySchema.safeParse({ search: 'x'.repeat(121) }).success).toBe(false);
  });

  it('no rompe los filtros existentes', () => {
    const parsed = listProductsQuerySchema.parse({ search: 'a', available: 'true', page: '2' });
    expect(parsed).toMatchObject({ search: 'a', available: true, page: 2 });
  });
});

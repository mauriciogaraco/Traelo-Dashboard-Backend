import { describe, expect, it } from 'vitest';
import { createCategorySchema } from './categories.dto';

describe('createCategorySchema slug', () => {
  it('acepta slugs kebab-case válidos', () => {
    for (const slug of ['comida-rapida', 'pizzas', 'postres-y-dulces', 'a1-b2']) {
      const result = createCategorySchema.safeParse({ name: 'Categoría', slug });
      expect(result.success).toBe(true);
    }
  });

  it('rechaza mayúsculas, espacios, guiones bajos y guiones dobles/al borde', () => {
    for (const slug of [
      'Comida-Rapida',
      'comida rapida',
      'comida_rapida',
      'comida--rapida',
      '-comida',
      'comida-',
    ]) {
      const result = createCategorySchema.safeParse({ name: 'Categoría', slug });
      expect(result.success).toBe(false);
    }
  });
});

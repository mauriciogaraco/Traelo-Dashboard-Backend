import { z } from 'zod';
import { booleanQueryParam, paginationQuerySchema } from '../../shared/http';
import { packagingSchema } from './packaging';

export const productParamsSchema = z.object({
  id: z.cuid('id de negocio inválido'),
  productId: z.cuid('id de producto inválido'),
});

export type ProductParams = z.infer<typeof productParamsSchema>;

export const listProductsQuerySchema = paginationQuerySchema.extend({
  // NOTA: "active" usa z.coerce.boolean(), que trata "false" como true (bug conocido,
  // ver task_8011a20e) — no lo cambio acá porque está fuera del alcance de esta tarea, pero
  // "available" (nuevo) sí usa el helper correcto (booleanQueryParam) para no repetirlo.
  active: z.coerce.boolean().optional(),
  available: booleanQueryParam.optional(),
  lowStock: booleanQueryParam.optional(),
  category: z.string().min(1).max(80).optional(),
  categoryId: z.cuid('id de categoría inválido').optional(),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const createProductSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  category: z.string().min(1).max(80).optional(),
  // categoryId es la navegación estructurada nueva (ver Category); category (arriba) sigue
  // siendo el string legacy, ambos coexisten hasta que se decida retirar el string.
  categoryId: z.cuid('id de categoría inválido').optional(),
  price: z.coerce.number().min(0).optional(),
  externalId: z.string().min(1).max(80).optional(),
  // Fase 22: solo la URL (a donde sea que esté alojada la imagen), nunca el binario.
  imageUrl: z.url('URL de imagen inválida').optional(),
  // Opciones de empaque entre las que elige el cliente (ver packaging.ts). Vacío/omitido = sin empaque.
  packaging: packagingSchema.optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().min(1).max(80).optional(),
  categoryId: z.cuid('id de categoría inválido').nullable().optional(),
  price: z.coerce.number().min(0).optional(),
  active: z.boolean().optional(),
  imageUrl: z.url('URL de imagen inválida').nullable().optional(),
  // null o [] quitan el empaque; omitido no lo toca.
  packaging: packagingSchema.nullable().optional(),
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// available = ¿se puede comprar? lowStock = ¿queda poco? (independiente — un producto puede
// seguir disponible pero avisando que se puede agotar pronto). Al menos uno de los dos.
export const setProductAvailabilitySchema = z
  .object({
    available: z.boolean().optional(),
    lowStock: z.boolean().optional(),
  })
  .refine((data) => data.available !== undefined || data.lowStock !== undefined, {
    message: 'Debe indicar available y/o lowStock',
  });

export type SetProductAvailabilityInput = z.infer<typeof setProductAvailabilitySchema>;

export const setProductCommissionSchema = z.object({
  commissionAmount: z.coerce.number().min(0),
});

export type SetProductCommissionInput = z.infer<typeof setProductCommissionSchema>;

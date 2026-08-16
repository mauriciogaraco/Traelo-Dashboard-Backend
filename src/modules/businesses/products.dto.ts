import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http';

export const productParamsSchema = z.object({
  id: z.cuid('id de negocio inválido'),
  productId: z.cuid('id de producto inválido'),
});

export type ProductParams = z.infer<typeof productParamsSchema>;

export const listProductsQuerySchema = paginationQuerySchema.extend({
  active: z.coerce.boolean().optional(),
  category: z.string().min(1).max(80).optional(),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const createProductSchema = z.object({
  name: z.string().min(1).max(150),
  category: z.string().min(1).max(80).optional(),
  price: z.coerce.number().min(0).optional(),
  externalId: z.string().min(1).max(80).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  category: z.string().min(1).max(80).optional(),
  price: z.coerce.number().min(0).optional(),
  active: z.boolean().optional(),
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const setProductCommissionSchema = z.object({
  commissionAmount: z.coerce.number().min(0),
});

export type SetProductCommissionInput = z.infer<typeof setProductCommissionSchema>;

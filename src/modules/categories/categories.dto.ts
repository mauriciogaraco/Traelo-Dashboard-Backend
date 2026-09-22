import { z } from 'zod';
import { booleanQueryParam, paginationQuerySchema } from '../../shared/http';

export const categoryIdParamSchema = z.object({
  id: z.cuid('id de categoría inválido'),
});

export type CategoryIdParam = z.infer<typeof categoryIdParamSchema>;

const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'slug inválido, se espera formato kebab-case (ej. "comida-rapida")',
  );

export const listCategoriesQuerySchema = paginationQuerySchema.extend({
  active: booleanQueryParam.optional(),
  search: z.string().min(1).max(120).optional(),
});

export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

export const createCategorySchema = z.object({
  name: z.string().min(2).max(80),
  slug: slugSchema,
  icon: z.string().min(1).max(80).optional(),
  imageUrl: z.url('URL de imagen inválida').optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.object({
  name: z.string().min(2).max(80).optional(),
  slug: slugSchema.optional(),
  icon: z.string().min(1).max(80).optional(),
  imageUrl: z.url('URL de imagen inválida').nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

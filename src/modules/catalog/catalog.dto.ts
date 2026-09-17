import { z } from 'zod';

export const listCatalogChangesQuerySchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

export type ListCatalogChangesQuery = z.infer<typeof listCatalogChangesQuerySchema>;

export const listCatalogBusinessesQuerySchema = z.object({
  search: z.string().min(1).max(120).optional(),
});

export type ListCatalogBusinessesQuery = z.infer<typeof listCatalogBusinessesQuerySchema>;

export const catalogBusinessIdParamSchema = z.object({
  businessId: z.cuid('id de negocio inválido'),
});

export type CatalogBusinessIdParam = z.infer<typeof catalogBusinessIdParamSchema>;

export const listCatalogProductsQuerySchema = z.object({
  categoryId: z.cuid('id de categoría inválido').optional(),
  search: z.string().min(1).max(120).optional(),
});

export type ListCatalogProductsQuery = z.infer<typeof listCatalogProductsQuerySchema>;

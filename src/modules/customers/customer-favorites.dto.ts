import { z } from 'zod';

export const favoriteBusinessParamsSchema = z.object({
  id: z.cuid('id de cliente inválido'),
  businessId: z.cuid('id de negocio inválido'),
});

export type FavoriteBusinessParams = z.infer<typeof favoriteBusinessParamsSchema>;

export const favoriteProductParamsSchema = z.object({
  id: z.cuid('id de cliente inválido'),
  productId: z.cuid('id de producto inválido'),
});

export type FavoriteProductParams = z.infer<typeof favoriteProductParamsSchema>;

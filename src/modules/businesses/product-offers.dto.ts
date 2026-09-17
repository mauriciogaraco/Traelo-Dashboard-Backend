import { z } from 'zod';

export const offerParamsSchema = z.object({
  id: z.cuid('id de negocio inválido'),
  productId: z.cuid('id de producto inválido'),
  offerId: z.cuid('id de oferta inválido'),
});

export type OfferParams = z.infer<typeof offerParamsSchema>;

export const createOfferSchema = z
  .object({
    price: z.coerce.number().min(0),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((data) => data.startsAt.getTime() < data.endsAt.getTime(), {
    message: 'startsAt debe ser anterior a endsAt',
    path: ['endsAt'],
  });

export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const updateOfferSchema = z
  .object({
    price: z.coerce.number().min(0).optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (data) => !data.startsAt || !data.endsAt || data.startsAt.getTime() < data.endsAt.getTime(),
    { message: 'startsAt debe ser anterior a endsAt', path: ['endsAt'] },
  );

export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;

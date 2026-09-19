import { z } from 'zod';

// Rating de 1.0 a 5.0 con UN decimal (paso 0.1). Se valida como número (no se coacciona un
// string) y se rechaza cualquier precisión mayor: 4.75 o 4.999 son inválidos, no se redondean
// en silencio. La BD refuerza el rango con un CHECK y Decimal(2,1).
export const ratingSchema = z
  .number()
  .min(1, 'La valoración mínima es 1.0')
  .max(5, 'La valoración máxima es 5.0')
  .refine((value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9, {
    message: 'La valoración admite un solo decimal (paso 0.1)',
  });

export const delivererReviewSchema = z.object({
  // Nunca se acepta delivererId: el mensajero se deduce del pedido.
  rating: ratingSchema,
});

export type DelivererReviewInput = z.infer<typeof delivererReviewSchema>;

export const businessReviewsSchema = z
  .object({
    reviews: z
      .array(
        z.object({
          businessId: z.cuid('id de negocio inválido'),
          rating: ratingSchema,
        }),
      )
      .min(1)
      .max(20),
  })
  .refine(
    (data) => new Set(data.reviews.map((review) => review.businessId)).size === data.reviews.length,
    { message: 'No se puede valorar dos veces el mismo negocio', path: ['reviews'] },
  );

export type BusinessReviewsInput = z.infer<typeof businessReviewsSchema>;

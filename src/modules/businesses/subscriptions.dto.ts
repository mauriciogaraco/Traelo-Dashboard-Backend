import { z } from 'zod';
import { SubscriptionCycle } from '../../generated/prisma/enums';

export const subscriptionParamsSchema = z.object({
  id: z.cuid('id de negocio inválido'),
  subId: z.cuid('id de suscripción inválido'),
});

export type SubscriptionParams = z.infer<typeof subscriptionParamsSchema>;

export const createSubscriptionSchema = z
  .object({
    cycle: z.enum(SubscriptionCycle),
    price: z.coerce.number().min(0),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine((data) => !data.startDate || !data.endDate || data.endDate > data.startDate, {
    message: 'endDate debe ser posterior a startDate',
    path: ['endDate'],
  });

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

export const updateSubscriptionSchema = z
  .object({
    status: z.literal('CANCELLED').optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine((data) => data.status !== undefined || data.endDate !== undefined, {
    message: 'Debe indicar status=CANCELLED o un nuevo endDate para renovar',
  });

export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

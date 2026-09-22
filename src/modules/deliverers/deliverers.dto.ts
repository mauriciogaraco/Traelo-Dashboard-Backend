import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http';

export const listDeliverersQuerySchema = paginationQuerySchema.extend({
  active: z.coerce.boolean().optional(),
  search: z.string().min(1).max(120).optional(),
});

export type ListDeliverersQuery = z.infer<typeof listDeliverersQuerySchema>;

export const createDelivererSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.email(),
  password: z.string().min(8).max(72),
  phone: z.string().min(6).max(30),
  joinedAt: z.coerce.date().optional(),
  commissionPercentage: z.coerce.number().min(0).max(100).optional(),
  photoUrl: z.url('URL de foto inválida').optional(),
});

export type CreateDelivererInput = z.infer<typeof createDelivererSchema>;

export const updateDelivererSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().min(6).max(30).optional(),
  active: z.boolean().optional(),
  commissionPercentage: z.coerce.number().min(0).max(100).nullable().optional(),
  // null = quitar la foto.
  photoUrl: z.url('URL de foto inválida').nullable().optional(),
});

export type UpdateDelivererInput = z.infer<typeof updateDelivererSchema>;

// Token de Expo Push del dispositivo del mensajero — ver Deliverer.expoPushToken (schema.prisma).
// `null` explícito es válido: lo manda la app al cerrar sesión, para que ese dispositivo deje
// de recibir avisos de un mensajero que ya no tiene sesión ahí.
export const updateDelivererPushTokenSchema = z.object({
  expoPushToken: z.string().min(1).max(200).nullable(),
});

export type UpdateDelivererPushTokenInput = z.infer<typeof updateDelivererPushTokenSchema>;

export const updateDelivererDutySchema = z.object({
  onDuty: z.boolean(),
});

export type UpdateDelivererDutyInput = z.infer<typeof updateDelivererDutySchema>;

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
});

export type CreateDelivererInput = z.infer<typeof createDelivererSchema>;

export const updateDelivererSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().min(6).max(30).optional(),
  active: z.boolean().optional(),
  commissionPercentage: z.coerce.number().min(0).max(100).nullable().optional(),
});

export type UpdateDelivererInput = z.infer<typeof updateDelivererSchema>;

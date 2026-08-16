import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http';
import { Role } from '../../generated/prisma/enums';

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: z.enum(Role).optional(),
  active: z.coerce.boolean().optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.email(),
  password: z.string().min(8).max(72),
  phone: z.string().min(6).max(30).optional(),
  role: z.enum(Role),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().min(6).max(30).optional(),
  active: z.boolean().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http';
import { Role } from '../../generated/prisma/enums';

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: z.enum(Role).optional(),
  active: z.coerce.boolean().optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const createUserSchema = z
  .object({
    name: z.string().min(2).max(120),
    email: z.email(),
    password: z.string().min(8).max(72),
    phone: z.string().min(6).max(30).optional(),
    role: z.enum(Role),
    // Solo para role = BUSINESS_OWNER: el negocio que administra esta cuenta.
    businessId: z.cuid('id de negocio inválido').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === Role.BUSINESS_OWNER && !data.businessId) {
      ctx.addIssue({
        code: 'custom',
        path: ['businessId'],
        message: 'Indicá el negocio que administra este dueño',
      });
    }
    if (data.role !== Role.BUSINESS_OWNER && data.businessId) {
      ctx.addIssue({
        code: 'custom',
        path: ['businessId'],
        message: 'Solo los dueños de negocio llevan un negocio asociado',
      });
    }
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().min(6).max(30).optional(),
  active: z.boolean().optional(),
  // Reasignar el negocio de un BUSINESS_OWNER (se rechaza si el usuario tiene otro rol).
  businessId: z.cuid('id de negocio inválido').optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(8).max(72),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

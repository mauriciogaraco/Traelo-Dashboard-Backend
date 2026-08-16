import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http';
import { CommissionType } from '../../generated/prisma/enums';

export const businessIdParamSchema = z.object({
  id: z.cuid('id de negocio inválido'),
});

export type BusinessIdParam = z.infer<typeof businessIdParamSchema>;

export const listBusinessesQuerySchema = paginationQuerySchema.extend({
  active: z.coerce.boolean().optional(),
  commissionType: z.enum(CommissionType).optional(),
  search: z.string().min(1).max(120).optional(),
});

export type ListBusinessesQuery = z.infer<typeof listBusinessesQuerySchema>;

export const createBusinessSchema = z
  .object({
    name: z.string().min(2).max(150),
    phone: z.string().min(6).max(30),
    address: z.string().min(3).max(300),
    joinedAt: z.coerce.date().optional(),
    commissionType: z.enum(CommissionType),
    commissionPercentage: z.coerce.number().min(0).max(100).optional(),
    defaultProductCommissionAmount: z.coerce.number().min(0).optional(),
  })
  .refine(
    (data) => data.commissionType !== 'PERCENTAGE' || data.commissionPercentage !== undefined,
    {
      message: 'commissionPercentage es requerido cuando commissionType es PERCENTAGE',
      path: ['commissionPercentage'],
    },
  )
  .refine(
    (data) =>
      data.commissionType !== 'FIXED_PER_PRODUCT' ||
      data.defaultProductCommissionAmount !== undefined,
    {
      message:
        'defaultProductCommissionAmount es requerido cuando commissionType es FIXED_PER_PRODUCT',
      path: ['defaultProductCommissionAmount'],
    },
  );

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;

export const updateBusinessSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  phone: z.string().min(6).max(30).optional(),
  address: z.string().min(3).max(300).optional(),
  active: z.boolean().optional(),
  commissionType: z.enum(CommissionType).optional(),
  commissionPercentage: z.coerce.number().min(0).max(100).optional(),
  defaultProductCommissionAmount: z.coerce.number().min(0).optional(),
});

export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;

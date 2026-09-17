import { z } from 'zod';

export const addressParamsSchema = z.object({
  id: z.cuid('id de cliente inválido'),
  addressId: z.cuid('id de dirección inválido'),
});

export type AddressParams = z.infer<typeof addressParamsSchema>;

export const createAddressSchema = z.object({
  label: z.string().min(1).max(60),
  address: z.string().min(3).max(300),
  reference: z.string().max(200).optional(),
  isDefault: z.boolean().optional().default(false),
});

export type CreateAddressInput = z.infer<typeof createAddressSchema>;

export const updateAddressSchema = z.object({
  label: z.string().min(1).max(60).optional(),
  address: z.string().min(3).max(300).optional(),
  reference: z.string().max(200).optional(),
  isDefault: z.boolean().optional(),
});

export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

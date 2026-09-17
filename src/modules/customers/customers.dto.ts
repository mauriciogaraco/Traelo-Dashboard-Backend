import { z } from 'zod';

export const customerIdParamSchema = z.object({
  id: z.cuid('id de cliente inválido'),
});

export type CustomerIdParam = z.infer<typeof customerIdParamSchema>;

export const createCustomerSchema = z.object({
  name: z.string().min(2).max(150),
  phone: z.string().min(6).max(30),
  email: z.email().optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

// El teléfono no se puede cambiar acá: es el identificador principal del cliente y todavía
// no hay flujo de verificación (OTP) para reasignarlo con seguridad — eso queda para cuando
// se diseñe la autenticación de Customer.
export const updateCustomerSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  email: z.email().optional(),
});

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

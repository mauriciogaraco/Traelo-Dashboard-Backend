import { z } from 'zod';

export const customerIdParamSchema = z.object({
  id: z.cuid('id de cliente inválido'),
});

export type CustomerIdParam = z.infer<typeof customerIdParamSchema>;

// El alta de clientes vive en /auth/customer/register (con contraseña). Ya no existe
// POST /customers: crear un cliente solo con un teléfono permitía ocupar números ajenos.
//
// El teléfono no se puede cambiar acá: es el identificador de la cuenta y todavía no hay
// verificación (OTP) para reasignarlo con seguridad.
export const updateCustomerSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  email: z.email().optional(),
});

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

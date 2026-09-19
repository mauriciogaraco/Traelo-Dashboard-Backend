import { z } from 'zod';
import { isValidPhone, normalizePhone } from '../../shared/phone';

// bcrypt solo considera los primeros 72 BYTES (no caracteres) de la contraseña: con acentos o
// emojis 72 caracteres pueden pasar de 72 bytes y el sobrante se ignoraría en silencio. Se
// valida en bytes para que lo que el usuario escribe sea lo que realmente cuenta.
const PASSWORD_MIN_BYTES = 8;
const PASSWORD_MAX_BYTES = 72;

export const passwordSchema = z
  .string()
  .refine((value) => Buffer.byteLength(value, 'utf8') >= PASSWORD_MIN_BYTES, {
    message: 'La contraseña debe tener al menos 8 caracteres',
  })
  .refine((value) => Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES, {
    message: 'La contraseña es demasiado larga (máximo 72 bytes)',
  });

// El teléfono se guarda y se busca en forma canónica (ver shared/phone).
export const phoneSchema = z
  .string()
  .max(40)
  .transform(normalizePhone)
  .refine(isValidPhone, { message: 'Teléfono inválido' });

export const registerCustomerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  phone: phoneSchema,
  password: passwordSchema,
  email: z
    .email()
    .max(200)
    .transform((value) => value.toLowerCase())
    .optional(),
});

export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;

export const loginCustomerSchema = z.object({
  phone: phoneSchema,
  // En login no se valida el mínimo (mensaje genérico ante cualquier fallo); solo se acota el
  // tamaño para no gastar bcrypt en basura ni truncar en silencio pasados los 72 bytes.
  password: z
    .string()
    .min(1)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES),
});

export type LoginCustomerInput = z.infer<typeof loginCustomerSchema>;

export const refreshCustomerSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});

export type RefreshCustomerInput = z.infer<typeof refreshCustomerSchema>;

export const forgotPasswordCustomerSchema = z.object({
  phone: phoneSchema,
});

export type ForgotPasswordCustomerInput = z.infer<typeof forgotPasswordCustomerSchema>;

export const resetPasswordCustomerSchema = z.object({
  token: z.string().min(1).max(512),
  newPassword: passwordSchema,
});

export type ResetPasswordCustomerInput = z.infer<typeof resetPasswordCustomerSchema>;

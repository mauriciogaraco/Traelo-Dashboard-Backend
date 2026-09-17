import { z } from 'zod';
import { booleanQueryParam } from '../../shared/http';

export const closureParamsSchema = z.object({
  id: z.cuid('id de negocio inválido'),
  closureId: z.cuid('id de cierre inválido'),
});

export type ClosureParams = z.infer<typeof closureParamsSchema>;

// Fecha sin hora: igual que referenceDateSchema en settlements.dto.ts, ancla a mediodía UTC
// para que "2026-12-25" no se corra al día calendario anterior por el desfase de La Habana
// respecto a UTC.
const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida, se espera YYYY-MM-DD')
  .transform((value) => new Date(`${value}T12:00:00.000Z`));

export const listClosuresQuerySchema = z.object({
  upcoming: booleanQueryParam.optional(),
});

export type ListClosuresQuery = z.infer<typeof listClosuresQuerySchema>;

export const createClosureSchema = z.object({
  date: dateOnlySchema,
  reason: z.string().min(1).max(200).optional(),
});

export type CreateClosureInput = z.infer<typeof createClosureSchema>;

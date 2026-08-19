import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http';
import { SettlementType, SettlementStatus } from '../../generated/prisma/enums';

// El <input type="date"> del frontend manda una fecha "desnuda" (YYYY-MM-DD). z.coerce.date()
// la interpretaría como medianoche UTC, que en hora de La Habana (UTC-4/-5) cae en el día
// calendario ANTERIOR — por eso se ancla al mediodía UTC, que sigue siendo el mismo día
// calendario en cualquier huso horario real antes de resolverla a hora de La Habana.
const referenceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida, se espera YYYY-MM-DD')
  .transform((value) => new Date(`${value}T12:00:00.000Z`));

export const generateSettlementSchema = z.object({
  delivererId: z.cuid(),
  date: referenceDateSchema.optional(),
});

export type GenerateSettlementInput = z.infer<typeof generateSettlementSchema>;

export const listSettlementsQuerySchema = paginationQuerySchema.extend({
  delivererId: z.cuid().optional(),
  type: z.enum(SettlementType).optional(),
  status: z.enum(SettlementStatus).optional(),
});

export type ListSettlementsQuery = z.infer<typeof listSettlementsQuerySchema>;

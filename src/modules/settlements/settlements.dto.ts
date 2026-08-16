import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http';
import { SettlementType, SettlementStatus } from '../../generated/prisma/enums';

export const generateSettlementSchema = z.object({
  delivererId: z.cuid(),
  date: z.coerce.date().optional(),
});

export type GenerateSettlementInput = z.infer<typeof generateSettlementSchema>;

export const listSettlementsQuerySchema = paginationQuerySchema.extend({
  delivererId: z.cuid().optional(),
  type: z.enum(SettlementType).optional(),
  status: z.enum(SettlementStatus).optional(),
});

export type ListSettlementsQuery = z.infer<typeof listSettlementsQuerySchema>;

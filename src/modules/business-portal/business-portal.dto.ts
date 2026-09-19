import { z } from 'zod';
import { dateRangePreset, dateRangeQuerySchema } from '../../shared/date-range';
import { paginationQuerySchema } from '../../shared/http';
import { OrderStatus } from '../../generated/prisma/enums';

export const portalSummaryQuerySchema = dateRangeQuerySchema;
export type PortalSummaryQuery = z.infer<typeof portalSummaryQuerySchema>;

export const portalOrdersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(OrderStatus).optional(),
  // Igual que /orders: sin range ni from/to = todos los pedidos.
  range: dateRangePreset.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().min(1).optional(),
});
export type PortalOrdersQuery = z.infer<typeof portalOrdersQuerySchema>;

export const portalCustomersQuerySchema = dateRangeQuerySchema.extend({
  sortBy: z.enum(['orderCount', 'totalSpent', 'lastOrder']).default('orderCount'),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type PortalCustomersQuery = z.infer<typeof portalCustomersQuerySchema>;

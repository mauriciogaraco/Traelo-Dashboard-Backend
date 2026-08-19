import { z } from 'zod';
import { dateRangeQuerySchema } from '../../shared/date-range';
import { paginationQuerySchema } from '../../shared/http';

export const reportsQuerySchema = dateRangeQuerySchema;
export type ReportsQuery = z.infer<typeof reportsQuerySchema>;

export const topReportsQuerySchema = dateRangeQuerySchema.extend({
  limit: z.coerce.number().int().positive().max(50).default(10),
});
export type TopReportsQuery = z.infer<typeof topReportsQuerySchema>;

export const listReportsQuerySchema = dateRangeQuerySchema.merge(paginationQuerySchema).extend({
  search: z.string().trim().min(1).optional(),
});
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;

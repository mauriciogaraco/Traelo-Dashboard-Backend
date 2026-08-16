import { z } from 'zod';
import { dateRangeQuerySchema } from '../../shared/date-range';

export const reportsQuerySchema = dateRangeQuerySchema;
export type ReportsQuery = z.infer<typeof reportsQuerySchema>;

export const topReportsQuerySchema = dateRangeQuerySchema.extend({
  limit: z.coerce.number().int().positive().max(50).default(10),
});
export type TopReportsQuery = z.infer<typeof topReportsQuerySchema>;

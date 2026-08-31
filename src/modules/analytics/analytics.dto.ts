import { z } from 'zod';
import { dateRangeQuerySchema } from '../../shared/date-range';

export const analyticsQuerySchema = dateRangeQuerySchema;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const productsByHourQuerySchema = dateRangeQuerySchema.extend({
  hour: z.coerce.number().int().min(0).max(23),
  limit: z.coerce.number().int().positive().max(50).default(10),
});
export type ProductsByHourQuery = z.infer<typeof productsByHourQuerySchema>;

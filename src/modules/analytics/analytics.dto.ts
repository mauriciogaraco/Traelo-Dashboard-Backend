import { z } from 'zod';
import { dateRangeQuerySchema } from '../../shared/date-range';

export const analyticsQuerySchema = dateRangeQuerySchema;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const productsByHourQuerySchema = dateRangeQuerySchema.extend({
  hour: z.coerce.number().int().min(0).max(23),
  limit: z.coerce.number().int().positive().max(50).default(10),
});
export type ProductsByHourQuery = z.infer<typeof productsByHourQuerySchema>;

export const customerTrendQuerySchema = dateRangeQuerySchema;
export type CustomerTrendQuery = z.infer<typeof customerTrendQuerySchema>;

// Independiente de los tabs de rango de la página: una cohorte necesita meses de historia,
// no tiene sentido acotarla a "Hoy"/"Semana".
export const retentionCohortsQuerySchema = z.object({
  months: z.coerce.number().int().min(2).max(12).default(6),
});
export type RetentionCohortsQuery = z.infer<typeof retentionCohortsQuerySchema>;

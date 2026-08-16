import { z } from 'zod';
import { BadRequestError } from '../errors';

export const dateRangePreset = z.enum(['today', 'week', 'month', '6months', 'year', 'custom']);

export const dateRangeQuerySchema = z.object({
  range: dateRangePreset.default('today'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

export interface DateRange {
  from: Date;
  to: Date;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function resolveDateRange(query: DateRangeQuery): DateRange {
  const now = new Date();

  switch (query.range) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'week': {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case 'month': {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 1);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case '6months': {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 6);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case 'year': {
      const from = new Date(now);
      from.setFullYear(from.getFullYear() - 1);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case 'custom': {
      if (!query.from || !query.to) {
        throw new BadRequestError('from y to son requeridos cuando range=custom');
      }
      if (query.from > query.to) {
        throw new BadRequestError('from no puede ser posterior a to');
      }
      return { from: startOfDay(query.from), to: endOfDay(query.to) };
    }
  }
}

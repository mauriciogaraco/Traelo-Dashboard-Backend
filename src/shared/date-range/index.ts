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

// El negocio opera en Cuba; "hoy/semana/mes/..." tienen que calcularse en hora de La Habana,
// no en la zona horaria del proceso (en producción corre en UTC) — si no, "hoy" no coincide
// con el día real del usuario y aparecen/desaparecen pedidos según la hora.
const BUSINESS_TIMEZONE = 'America/Havana';

function getZonedDateParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map: Partial<Record<string, string>> = {};
  for (const part of parts) map[part.type] = part.value;
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

// Diferencia (ms) entre "leer la hora local de `timeZone` en `date` como si fuera UTC" y el
// instante real — equivale al offset de esa zona en ese momento (respeta el horario de verano).
function getZonedOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const map: Partial<Record<string, string>> = {};
  for (const part of parts) map[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - date.getTime();
}

/** Instante UTC de la medianoche (00:00:00.000) del día calendario de `date` en `timeZone`. */
function zonedStartOfDay(date: Date, timeZone: string): Date {
  const { year, month, day } = getZonedDateParts(date, timeZone);
  const guessUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offset = getZonedOffsetMs(new Date(guessUtc), timeZone);
  return new Date(guessUtc - offset);
}

/** Instante UTC justo antes de la medianoche siguiente, en `timeZone`. */
function zonedEndOfDay(date: Date, timeZone: string): Date {
  const { year, month, day } = getZonedDateParts(date, timeZone);
  // Mismo cálculo que zonedStartOfDay pero para el día calendario siguiente (day + 1, que
  // Date.UTC normaliza solo si hace falta cruzar de mes/año) — no se puede resolver pasando por
  // getZonedDateParts de un instante UTC intermedio, porque ese instante todavía podría caer en
  // el día calendario anterior en `timeZone` y devolver el mismo día otra vez.
  const guessUtcNextDay = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0);
  const offset = getZonedOffsetMs(new Date(guessUtcNextDay), timeZone);
  const nextDayStart = new Date(guessUtcNextDay - offset);
  return new Date(nextDayStart.getTime() - 1);
}

/** Medianoche del día calendario de `date` en La Habana, como instante UTC. */
export function startOfBusinessDay(date: Date): Date {
  return zonedStartOfDay(date, BUSINESS_TIMEZONE);
}

/** Último instante (23:59:59.999) del día calendario de `date` en La Habana, como instante UTC. */
export function endOfBusinessDay(date: Date): Date {
  return zonedEndOfDay(date, BUSINESS_TIMEZONE);
}

/** Lunes (medianoche) de la semana ISO que contiene a `date`, en La Habana. */
export function startOfBusinessIsoWeek(date: Date): Date {
  const dayStart = startOfBusinessDay(date);
  // `dayStart` es la medianoche de La Habana expresada en UTC; su hora UTC nunca cruza más allá
  // del offset de la zona (unas pocas horas), así que su día-de-semana en UTC coincide con el
  // día-de-semana real en La Habana.
  const weekday = dayStart.getUTCDay();
  const diffToMonday = (weekday === 0 ? -6 : 1) - weekday;
  const shifted = new Date(dayStart);
  shifted.setUTCDate(shifted.getUTCDate() + diffToMonday);
  return startOfBusinessDay(shifted);
}

/** Domingo (fin de día) de la semana ISO que contiene a `date`, en La Habana. */
export function endOfBusinessIsoWeek(date: Date): Date {
  const start = startOfBusinessIsoWeek(date);
  const shifted = new Date(start);
  shifted.setUTCDate(shifted.getUTCDate() + 6);
  return endOfBusinessDay(shifted);
}

export function resolveDateRange(query: DateRangeQuery): DateRange {
  const now = new Date();

  switch (query.range) {
    case 'today':
      return { from: zonedStartOfDay(now, BUSINESS_TIMEZONE), to: zonedEndOfDay(now, BUSINESS_TIMEZONE) };
    case 'week': {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      return { from: zonedStartOfDay(from, BUSINESS_TIMEZONE), to: zonedEndOfDay(now, BUSINESS_TIMEZONE) };
    }
    case 'month': {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 1);
      return { from: zonedStartOfDay(from, BUSINESS_TIMEZONE), to: zonedEndOfDay(now, BUSINESS_TIMEZONE) };
    }
    case '6months': {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 6);
      return { from: zonedStartOfDay(from, BUSINESS_TIMEZONE), to: zonedEndOfDay(now, BUSINESS_TIMEZONE) };
    }
    case 'year': {
      const from = new Date(now);
      from.setFullYear(from.getFullYear() - 1);
      return { from: zonedStartOfDay(from, BUSINESS_TIMEZONE), to: zonedEndOfDay(now, BUSINESS_TIMEZONE) };
    }
    case 'custom': {
      if (!query.from || !query.to) {
        throw new BadRequestError('from y to son requeridos cuando range=custom');
      }
      if (query.from > query.to) {
        throw new BadRequestError('from no puede ser posterior a to');
      }
      return {
        from: zonedStartOfDay(query.from, BUSINESS_TIMEZONE),
        to: zonedEndOfDay(query.to, BUSINESS_TIMEZONE),
      };
    }
  }
}

import { z } from 'zod';
import { timeStringToDate } from '../../shared/time';

export const businessHoursParamsSchema = z.object({
  id: z.cuid('id de negocio inválido'),
  dayOfWeek: z.coerce
    .number()
    .int()
    .min(0)
    .max(6, 'dayOfWeek debe estar entre 0 (domingo) y 6 (sábado)'),
});

export type BusinessHoursParams = z.infer<typeof businessHoursParamsSchema>;

const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Formato esperado HH:mm')
  .transform(timeStringToDate);

// openTime/closeTime son siempre requeridos, incluso cuando closed=true: "closed" es un
// override temporal sobre un horario que se conserva (para poder reactivarlo sin
// retipearlo), no una forma de dejar el horario sin definir.
export const upsertBusinessHoursSchema = z
  .object({
    openTime: timeStringSchema,
    closeTime: timeStringSchema,
    closed: z.boolean().optional().default(false),
  })
  .refine(
    // Si openTime/closeTime ya fallaron su propio regex, Zod igual ejecuta este refine con
    // el valor crudo (string) sin transformar — sin esta guarda, .getTime() explota con un
    // TypeError (500) en vez de dejar que se reporte solo el error de formato (400).
    (data) =>
      !(data.openTime instanceof Date) ||
      !(data.closeTime instanceof Date) ||
      data.openTime.getTime() < data.closeTime.getTime(),
    {
      message: 'openTime debe ser anterior a closeTime',
      path: ['closeTime'],
    },
  );

export type UpsertBusinessHoursInput = z.infer<typeof upsertBusinessHoursSchema>;

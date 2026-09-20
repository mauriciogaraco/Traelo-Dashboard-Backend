import { z } from 'zod';

export const updateSystemConfigSchema = z.object({
  defaultDelivererCommissionPercentage: z.coerce.number().min(0).max(100).optional(),
  // Bloque promocional que se agrega al final del vale generado (p.ej. campaña de sorteo).
  // Texto vacío/null = no agregar nada, sin necesidad de un flag "activo" aparte.
  rafflePromoText: z.string().max(2000).nullable().optional(),
  raffleVideoUrl: z.url().nullable().optional(),
  // Puntos V1: cada cuántos CUP de Servicio Tráelo se da 1 punto (entero >= 1).
  pointsServiceDivisor: z.coerce.number().int().min(1).max(100000).optional(),
  // Puntos de bienvenida por el primer pedido desde la app (0 = desactivado).
  pointsFirstOrderBonus: z.coerce.number().int().min(0).max(100000).optional(),
});

export type UpdateSystemConfigInput = z.infer<typeof updateSystemConfigSchema>;

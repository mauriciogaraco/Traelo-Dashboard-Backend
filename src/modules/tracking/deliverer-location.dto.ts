import { z } from 'zod';

// El body NO acepta delivererId ni timestamp: el mensajero sale del token y `updatedAt` lo pone
// el servidor. Los campos desconocidos se ignoran (zod los descarta), nunca se usan.
export const updateDelivererLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).nullish(),
});

export type UpdateDelivererLocationInput = z.infer<typeof updateDelivererLocationSchema>;

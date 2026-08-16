import { z } from 'zod';

export const updateSystemConfigSchema = z.object({
  defaultDelivererCommissionPercentage: z.coerce.number().min(0).max(100),
});

export type UpdateSystemConfigInput = z.infer<typeof updateSystemConfigSchema>;

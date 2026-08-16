import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.cuid('id inválido'),
});

export type IdParam = z.infer<typeof idParamSchema>;

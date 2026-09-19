import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';

// Opción de empaque/envase de un producto (ej. Termopack, Caja, Jaba). El cliente elige una al
// comprar. `price` es el costo del empaque en CUP (0 = "sin empaque"). `capacity`, si existe, son
// las unidades que caben en un empaque; sin ella se cobra un empaque por unidad.
export const packagingOptionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  price: z.coerce.number().min(0).max(1_000_000),
  capacity: z.coerce.number().int().min(1).max(10_000).optional(),
});

export const packagingSchema = z
  .array(packagingOptionSchema)
  .max(10)
  .refine((options) => new Set(options.map((o) => o.name.toLowerCase())).size === options.length, {
    message: 'Los nombres de empaque no pueden repetirse',
  });

export type PackagingOption = z.infer<typeof packagingOptionSchema>;

// Lectura tolerante desde la columna Json: lo que no valide (datos viejos o editados a mano en la
// base) se trata como "sin empaque" en vez de romper el listado de productos.
export function parsePackaging(value: unknown): PackagingOption[] | null {
  const parsed = packagingSchema.safeParse(value);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}

// Escritura: undefined = no tocar la columna; null o lista vacía = quitar el empaque (NULL en SQL).
export function packagingToDb(
  value: PackagingOption[] | null | undefined,
): Prisma.InputJsonValue | Prisma.NullTypes.DbNull | undefined {
  if (value === undefined) return undefined;
  return value === null || value.length === 0 ? Prisma.DbNull : value;
}

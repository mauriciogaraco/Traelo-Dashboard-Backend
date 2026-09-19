import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';

// Opción de empaque/envase de un producto (ej. Termopack, Caja, Jaba). El cliente elige una al
// comprar. `price` es el costo del empaque en CUP (0 = "sin empaque"). `capacity`, si existe, son
// las unidades que caben en un empaque; sin ella se cobra un empaque por unidad.
export const packagingOptionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  price: z.coerce.number().min(0).max(1_000_000),
  // null o '' equivalen a "sin capacidad" (así llega desde formularios y desde el catálogo web).
  capacity: z.preprocess(
    (value) => (value === null || value === '' ? undefined : value),
    z.coerce.number().int().min(1).max(10_000).optional(),
  ),
});

const packagingListSchema = z
  .array(packagingOptionSchema)
  .max(10)
  .refine((options) => new Set(options.map((o) => o.name.toLowerCase())).size === options.length, {
    message: 'Los nombres de empaque no pueden repetirse',
  });

export type PackagingOption = z.infer<typeof packagingOptionSchema>;

// Flexibilidad de entrada: null/''/undefined = sin empaque, un objeto suelto = una sola opción,
// un texto JSON se interpreta, y las entradas null de una lista se ignoran.
function normalizePackagingInput(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'string') {
    try {
      return normalizePackagingInput(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.filter((entry) => entry !== null && entry !== undefined);
  if (typeof value === 'object') return [value];
  return value;
}

export const packagingSchema = z.preprocess(normalizePackagingInput, packagingListSchema);

// Lectura tolerante desde la columna Json: se conservan las opciones válidas y se descartan las que
// no (datos viejos o editados a mano en la base) en vez de romper o esconder todo el empaque.
export function parsePackaging(value: unknown): PackagingOption[] | null {
  const normalized = normalizePackagingInput(value);
  if (!Array.isArray(normalized)) return null;
  const seen = new Set<string>();
  const valid: PackagingOption[] = [];
  for (const entry of normalized) {
    const parsed = packagingOptionSchema.safeParse(entry);
    if (!parsed.success) continue;
    const key = parsed.data.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(parsed.data);
  }
  return valid.length > 0 ? valid.slice(0, 10) : null;
}

// Escritura: undefined = no tocar la columna; null o lista vacía = quitar el empaque (NULL en SQL).
export function packagingToDb(
  value: PackagingOption[] | null | undefined,
): Prisma.InputJsonValue | Prisma.NullTypes.DbNull | undefined {
  if (value === undefined) return undefined;
  return value === null || value.length === 0 ? Prisma.DbNull : value;
}

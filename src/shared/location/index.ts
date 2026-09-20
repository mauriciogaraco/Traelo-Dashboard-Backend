import { z } from 'zod';

// Ubicación exacta OPCIONAL de una entrega (pin colocado por el cliente). Nunca es requisito para
// pedir: en todos los DTOs va como campo opcional y su ausencia jamás rechaza nada. Latitud y
// longitud siempre viajan juntas — un objeto `location` sin alguna de las dos es inválido.
export const locationSourceSchema = z.enum(['MANUAL_PIN', 'DEVICE_LOCATION']);

export const deliveryLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  // Metros; solo tiene sentido cuando vino del GPS del dispositivo.
  accuracy: z.number().min(0).nullish(),
  source: locationSourceSchema.optional().default('MANUAL_PIN'),
});

export type DeliveryLocationInput = z.infer<typeof deliveryLocationSchema>;

// Forma persistida en CustomerAddress (columnas planas).
export interface StoredLocation {
  latitude: number;
  longitude: number;
  locationSource: 'MANUAL_PIN' | 'DEVICE_LOCATION';
  locationAccuracy: number | null;
}

export function toStoredLocation(location: DeliveryLocationInput): StoredLocation {
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    locationSource: location.source,
    // La precisión solo se guarda si el punto vino del GPS: un pin manual no tiene "precisión".
    locationAccuracy: location.source === 'DEVICE_LOCATION' ? (location.accuracy ?? null) : null,
  };
}

// Columnas que dejan una dirección SIN ubicación.
export const NO_STORED_LOCATION = {
  latitude: null,
  longitude: null,
  locationSource: null,
  locationAccuracy: null,
} as const;

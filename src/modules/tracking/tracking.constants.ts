// Reglas de tiempo del seguimiento en vivo, centralizadas para no repartir números mágicos.

// Tope de antigüedad con el que el backend todavía entrega una ubicación. Es una barrera de
// privacidad (no un umbral de UI): una posición vieja —p.ej. de la entrega anterior del mismo
// mensajero— no se muestra como si fuera de este pedido. Lo "fresca/desactualizada" lo decide
// la app con sus propios umbrales, mucho menores que este.
export const LOCATION_MAX_AGE_MS = 30 * 60 * 1000;

import { env } from '../../config/env';
import { OsrmRouteProvider } from './osrm-route-provider';
import { distanceMeters, distanceToPolylineMeters } from './geo';
import type { RoutePoint, RouteProvider, RouteResult } from './route-provider';

// Se re-exportan aquí: es la API pública del módulo (tests y herramientas de desarrollo las usan).
export { distanceMeters, distanceToPolylineMeters };

// Reglas de frecuencia: la ruta NO se recalcula en cada consulta de tracking (la app consulta cada
// ~8 s). Se sirve la última calculada y se refresca en segundo plano cuando hace falta:
//  - el mensajero SE DESVIÓ de la ruta (más de ROUTE_OFF_ROUTE_METERS de la línea): recalcular ya;
//  - avanzó bastante (ROUTE_MOVED_METERS) o pasó ROUTE_MAX_AGE_MS: refresco periódico;
// y nunca más de un cálculo cada ROUTE_MIN_INTERVAL_MS por pedido.
export const ROUTE_MIN_INTERVAL_MS = 8_000;
export const ROUTE_MAX_AGE_MS = 30_000;
export const ROUTE_MOVED_METERS = 150;
export const ROUTE_OFF_ROUTE_METERS = 40;
export const ROUTE_FAILURE_BACKOFF_MS = 30_000; // tras un fallo, esperar antes de reintentar
export const ROUTE_DISCARD_AFTER_MS = 5 * 60_000; // una ruta muy vieja engaña más de lo que ayuda
const MAX_ENTRIES = 500;

// Lo que ve el cliente: el recorrido y la distancia. A propósito NO se expone la duración (ETA).
export interface OrderRouteDTO {
  coordinates: RoutePoint[];
  distanceMeters: number;
  computedAt: Date;
}

interface CacheEntry {
  route: RouteResult | null;
  computedAt: number;
  attemptedAt: number;
  failed: boolean;
  inFlight: boolean;
  from: RoutePoint;
  to: RoutePoint;
}

// Por pedido: solo se sirve a quien ya pasó la autorización del tracking de ESE pedido.
const cache = new Map<string, CacheEntry>();
let provider: RouteProvider | null = null;

function getProvider(): RouteProvider {
  provider ??= new OsrmRouteProvider(env.ROUTING_BASE_URL);
  return provider;
}

// Para tests y para cambiar de motor sin tocar el resto.
export function setRouteProvider(next: RouteProvider | null): void {
  provider = next;
}

export function resetRouteCache(): void {
  cache.clear();
}

const sameDestination = (a: RoutePoint, b: RoutePoint) =>
  Math.abs(a.latitude - b.latitude) < 1e-6 && Math.abs(a.longitude - b.longitude) < 1e-6;

async function refresh(
  orderId: string,
  from: RoutePoint,
  to: RoutePoint,
  now: number,
): Promise<void> {
  const entry = cache.get(orderId);
  if (!entry) return;
  entry.inFlight = true;
  entry.attemptedAt = now;
  entry.from = from;
  entry.to = to;
  try {
    const route = await getProvider().getRoute(from, to);
    if (route) {
      entry.route = route;
      entry.computedAt = now;
      entry.failed = false;
    } else {
      entry.failed = true;
    }
  } catch {
    entry.failed = true; // el proveedor no debería lanzar; si lo hace, tampoco afecta al tracking
  } finally {
    entry.inFlight = false;
  }
}

function evictIfNeeded(): void {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

/**
 * Última ruta conocida del mensajero al destino de un pedido, o null si todavía no hay. NUNCA
 * espera al motor de rutas: si hace falta, dispara el cálculo en segundo plano y la respuesta de
 * tracking sale igual de rápida (la ruta aparece en la siguiente consulta). Un fallo del motor
 * solo significa "sin ruta"; el tracking sigue igual.
 */
export function getRouteForOrder(
  orderId: string,
  from: RoutePoint,
  to: RoutePoint,
  now: number = Date.now(),
): OrderRouteDTO | null {
  let entry = cache.get(orderId);

  // El destino cambió (p. ej. el staff corrigió la dirección): la ruta vieja ya no sirve.
  if (entry && !sameDestination(entry.to, to)) {
    cache.delete(orderId);
    entry = undefined;
  }

  if (!entry) {
    entry = {
      route: null,
      computedAt: 0,
      attemptedAt: 0,
      failed: false,
      inFlight: false,
      from,
      to,
    };
    cache.set(orderId, entry);
    evictIfNeeded();
    void refresh(orderId, from, to, now);
  } else if (!entry.inFlight) {
    const sinceAttempt = now - entry.attemptedAt;
    const waited =
      sinceAttempt >= (entry.failed ? ROUTE_FAILURE_BACKOFF_MS : ROUTE_MIN_INTERVAL_MS);
    const stale = now - entry.computedAt >= ROUTE_MAX_AGE_MS;
    const moved = distanceMeters(entry.from, from) >= ROUTE_MOVED_METERS;
    // Desvío: el mensajero ya no está sobre la línea calculada (tomó otra calle, se equivocó de
    // giro…). Es el caso que más importa recalcular sin esperar al refresco periódico.
    const offRoute =
      entry.route !== null &&
      distanceToPolylineMeters(from, entry.route.coordinates) > ROUTE_OFF_ROUTE_METERS;
    if (waited && (stale || moved || offRoute || entry.failed))
      void refresh(orderId, from, to, now);
  }

  if (!entry.route || now - entry.computedAt > ROUTE_DISCARD_AFTER_MS) return null;
  return {
    coordinates: entry.route.coordinates,
    distanceMeters: entry.route.distanceMeters,
    computedAt: new Date(entry.computedAt),
  };
}

// El pedido ya no tiene seguimiento activo: no se guarda nada más de su recorrido.
export function forgetRoute(orderId: string): void {
  cache.delete(orderId);
}

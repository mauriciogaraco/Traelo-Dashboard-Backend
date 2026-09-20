import { logger } from '../../shared/logger';
import { distanceMeters } from './geo';
import type { RoutePoint, RouteProvider, RouteResult } from './route-provider';

const REQUEST_TIMEOUT_MS = 4000;
// Tope defensivo de puntos por ruta (con overview=simplified suelen ser decenas): la respuesta de
// tracking se consulta cada pocos segundos y la app puede tener datos móviles limitados.
const MAX_POINTS = 150;
// Diferencia mínima entre el punto real y el "pegado" a la calle para añadir un tramo de enlace.
const CONNECTOR_MIN_METERS = 3;

interface OsrmResponse {
  code?: string;
  routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
}

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

// Reduce la lista conservando siempre el primer y el último punto.
function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => items[Math.round(index * step)] as T);
}

// Cliente de la API HTTP de OSRM (GET /route/v1/driving/{lng,lat;lng,lat}). OJO: OSRM usa
// longitud primero; aquí se convierte a { latitude, longitude } en un solo lugar.
export class OsrmRouteProvider implements RouteProvider {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async getRoute(from: RoutePoint, to: RoutePoint): Promise<RouteResult | null> {
    const coordinates = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
    const url = `${this.baseUrl}/route/v1/driving/${coordinates}?overview=simplified&geometries=geojson&steps=false`;
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'Traelo-backend/1.0 (seguimiento de pedidos)' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, 'El motor de rutas respondió con error');
        return null;
      }
      const body = (await response.json()) as OsrmResponse;
      const route = body.code === 'Ok' ? body.routes?.[0] : undefined;
      if (
        !route ||
        !Array.isArray(route.geometry?.coordinates) ||
        route.geometry.coordinates.length < 2
      ) {
        return null;
      }
      const snapped = downsample(route.geometry.coordinates, MAX_POINTS).map(
        ([longitude, latitude]) => ({
          latitude: round5(latitude),
          longitude: round5(longitude),
        }),
      );
      // OSRM "pega" origen y destino a la calle más cercana: la línea empezaría/terminaría a
      // decenas de metros del mensajero y del pin. Se añaden los puntos reales como extremos
      // (y su tramo a la distancia) para que la línea los una de verdad.
      const first = snapped[0] as RoutePoint;
      const last = snapped[snapped.length - 1] as RoutePoint;
      const startGap = distanceMeters(from, first);
      const endGap = distanceMeters(last, to);
      const coordinates = [
        ...(startGap > CONNECTOR_MIN_METERS ? [from] : []),
        ...snapped,
        ...(endGap > CONNECTOR_MIN_METERS ? [to] : []),
      ];
      return {
        coordinates,
        distanceMeters: Math.round(
          route.distance +
            (startGap > CONNECTOR_MIN_METERS ? startGap : 0) +
            (endGap > CONNECTOR_MIN_METERS ? endGap : 0),
        ),
        durationSeconds: Math.round(route.duration),
      };
    } catch (error) {
      logger.warn({ err: error }, 'No se pudo calcular la ruta');
      return null;
    }
  }
}

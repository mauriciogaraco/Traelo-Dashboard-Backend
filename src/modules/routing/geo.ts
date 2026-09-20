import type { RoutePoint } from './route-provider';

// Distancia aproximada en metros entre dos puntos (haversine).
export function distanceMeters(a: RoutePoint, b: RoutePoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

// Distancia (metros) de un punto a la polilínea: la del segmento más cercano. Proyección plana
// local (equirectangular): de sobra precisa a escala de ciudad.
export function distanceToPolylineMeters(point: RoutePoint, path: RoutePoint[]): number {
  if (path.length === 0) return Infinity;
  const metersPerDegLat = 110_540;
  const metersPerDegLng = 111_320 * Math.cos((point.latitude * Math.PI) / 180);
  const toXY = (p: RoutePoint) => ({
    x: (p.longitude - point.longitude) * metersPerDegLng,
    y: (p.latitude - point.latitude) * metersPerDegLat,
  });
  let best = Infinity;
  for (let i = 0; i < path.length; i += 1) {
    const a = toXY(path[i] as RoutePoint);
    const b = i + 1 < path.length ? toXY(path[i + 1] as RoutePoint) : a;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    // Proyección del origen (el punto) sobre el segmento a→b, acotada a [0, 1].
    const t =
      lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

// Contrato del motor de rutas. El resto del sistema (tracking, app) solo conoce esto: cambiar de
// OSRM público a uno propio, Valhalla o un servicio de pago es escribir otro RouteProvider.
export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface RouteResult {
  // Recorrido por calles, ya simplificado, del origen al destino.
  coordinates: RoutePoint[];
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteProvider {
  // null = no se pudo calcular (sin ruta, error, timeout). Nunca lanza: un fallo del motor de
  // rutas no debe afectar al seguimiento del pedido.
  getRoute(from: RoutePoint, to: RoutePoint): Promise<RouteResult | null>;
}

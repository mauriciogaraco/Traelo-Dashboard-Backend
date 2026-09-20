import { beforeEach, describe, expect, it, vi } from 'vitest';
import { distanceMeters, distanceToPolylineMeters } from './geo';
import {
  ROUTE_MAX_AGE_MS,
  ROUTE_MIN_INTERVAL_MS,
  ROUTE_MOVED_METERS,
  ROUTE_OFF_ROUTE_METERS,
  getRouteForOrder,
  resetRouteCache,
  setRouteProvider,
} from './routing.service';
import type { RoutePoint, RouteProvider, RouteResult } from './route-provider';

// Ruta de prueba: una calle recta de oeste a este, ~1,1 km (0,01° de longitud ≈ 1,03 km a esta latitud).
const A: RoutePoint = { latitude: 22.8, longitude: -82.52 };
const B: RoutePoint = { latitude: 22.8, longitude: -82.51 };
const DESTINATION = B;
const ROUTE: RouteResult = { coordinates: [A, B], distanceMeters: 1025, durationSeconds: 130 };

const metersNorth = (point: RoutePoint, meters: number): RoutePoint => ({
  ...point,
  latitude: point.latitude + meters / 110_540,
});
const metersEast = (point: RoutePoint, meters: number): RoutePoint => ({
  ...point,
  longitude: point.longitude + meters / (111_320 * Math.cos((point.latitude * Math.PI) / 180)),
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
const T0 = 5_000_000;
let getRoute: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  resetRouteCache();
  getRoute = vi.fn(async () => ROUTE);
  setRouteProvider({ getRoute } as RouteProvider);
  // Ruta ya calculada con el mensajero saliendo de A.
  getRouteForOrder('o1', A, DESTINATION, T0);
  await settle();
  getRoute.mockClear();
});

describe('distanceToPolylineMeters', () => {
  it('un punto sobre la línea está a ~0 m', () => {
    expect(distanceToPolylineMeters(metersEast(A, 300), [A, B])).toBeLessThan(1);
  });

  it('un punto apartado de la calle mide su distancia perpendicular', () => {
    expect(distanceToPolylineMeters(metersNorth(metersEast(A, 300), 60), [A, B])).toBeCloseTo(
      60,
      0,
    );
  });

  it('más allá del final de un segmento mide la distancia al extremo (no a la recta infinita)', () => {
    const beyond = metersEast(B, 80);
    expect(distanceToPolylineMeters(beyond, [A, B])).toBeCloseTo(distanceMeters(beyond, B), 0);
  });

  it('toma el segmento más cercano de una ruta con curvas', () => {
    const corner = metersNorth(B, 500);
    const path = [A, B, corner];
    expect(distanceToPolylineMeters(metersEast(metersNorth(B, 250), 30), path)).toBeCloseTo(30, 0);
  });

  it('una ruta vacía o de un solo punto no rompe', () => {
    expect(distanceToPolylineMeters(A, [])).toBe(Infinity);
    expect(distanceToPolylineMeters(metersNorth(A, 25), [A])).toBeCloseTo(25, 0);
  });
});

describe('recálculo por desvío del mensajero', () => {
  it('se recalcula enseguida si se aparta de la línea más del límite (a partir del intervalo mínimo)', () => {
    // Otra calle, paralela, a ~100 m del origen: el avance (<150 m) NO dispara nada; solo el desvío.
    const detour = metersNorth(metersEast(A, 100), ROUTE_OFF_ROUTE_METERS + 25);
    getRouteForOrder('o1', detour, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS);
    expect(getRoute).toHaveBeenCalledTimes(1);
    expect(getRoute).toHaveBeenCalledWith(detour, DESTINATION); // la nueva ruta sale desde donde está AHORA
  });

  it('no espera al refresco periódico: el desvío se detecta mucho antes de los 30 s', () => {
    expect(ROUTE_MIN_INTERVAL_MS).toBeLessThan(ROUTE_MAX_AGE_MS);
    const detour = metersNorth(metersEast(A, 100), 120);
    getRouteForOrder('o1', detour, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS);
    expect(getRoute).toHaveBeenCalledTimes(1);
  });

  it('aun desviándose, no se consulta al motor más de una vez cada intervalo mínimo', () => {
    const detour = metersNorth(metersEast(A, 300), 120);
    getRouteForOrder('o1', detour, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS - 1);
    expect(getRoute).not.toHaveBeenCalled();
  });

  it('una pequeña diferencia con la línea (< límite, p. ej. el otro carril) NO recalcula', () => {
    // A ~100 m del origen (menos que el umbral de avance): aquí solo puede decidir el criterio de desvío.
    const slightlyOff = metersNorth(metersEast(A, 100), ROUTE_OFF_ROUTE_METERS - 15);
    getRouteForOrder('o1', slightlyOff, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS + 2_000);
    expect(getRoute).not.toHaveBeenCalled();
  });

  it('avanzar por la ruta poco a poco (sobre la línea, < 150 m) no recalcula', () => {
    const progressed = metersEast(A, ROUTE_MOVED_METERS - 40);
    getRouteForOrder('o1', progressed, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS + 2_000);
    expect(getRoute).not.toHaveBeenCalled();
  });

  it('avanzar ≥150 m por la ruta refresca (distancia y tramo restante se mantienen al día)', () => {
    const progressed = metersEast(A, ROUTE_MOVED_METERS + 50);
    getRouteForOrder('o1', progressed, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS);
    expect(getRoute).toHaveBeenCalledTimes(1);
  });

  it('aunque el mensajero esté quieto sobre la ruta, se refresca cada 30 s', () => {
    getRouteForOrder('o1', A, DESTINATION, T0 + ROUTE_MAX_AGE_MS - 1);
    expect(getRoute).not.toHaveBeenCalled();
    getRouteForOrder('o1', A, DESTINATION, T0 + ROUTE_MAX_AGE_MS);
    expect(getRoute).toHaveBeenCalledTimes(1);
  });

  it('tras recalcular por desvío, la ruta nueva reemplaza a la anterior y el mensajero vuelve a estar "sobre la línea"', async () => {
    const detour = metersNorth(metersEast(A, 300), 150);
    const newRoute: RouteResult = {
      coordinates: [detour, B],
      distanceMeters: 800,
      durationSeconds: 100,
    };
    getRoute.mockResolvedValue(newRoute);

    getRouteForOrder('o1', detour, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS);
    await settle();
    getRoute.mockClear();

    // Ya está sobre la nueva línea: la siguiente consulta no pide otro cálculo.
    const served = getRouteForOrder('o1', detour, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS * 2);
    expect(served?.distanceMeters).toBe(800);
    expect(getRoute).not.toHaveBeenCalled();
  });
});

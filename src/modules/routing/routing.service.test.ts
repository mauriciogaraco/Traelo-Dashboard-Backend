import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROUTE_DISCARD_AFTER_MS,
  ROUTE_FAILURE_BACKOFF_MS,
  ROUTE_MAX_AGE_MS,
  ROUTE_MIN_INTERVAL_MS,
  distanceMeters,
  forgetRoute,
  getRouteForOrder,
  resetRouteCache,
  setRouteProvider,
} from './routing.service';
import type { RoutePoint, RouteProvider, RouteResult } from './route-provider';

const DESTINATION: RoutePoint = { latitude: 22.7958, longitude: -82.5065 };
const START: RoutePoint = { latitude: 22.8066, longitude: -82.513 };
// ~ +0.0015° de latitud ≈ 167 m; +0.0004° ≈ 44 m
const MOVED_FAR: RoutePoint = { latitude: START.latitude - 0.0015, longitude: START.longitude };
const MOVED_LITTLE: RoutePoint = { latitude: START.latitude - 0.0004, longitude: START.longitude };

const ROUTE: RouteResult = {
  coordinates: [START, DESTINATION],
  distanceMeters: 1797,
  durationSeconds: 190,
};

const settle = () => new Promise((resolve) => setImmediate(resolve));
const T0 = 1_000_000;

let getRoute: ReturnType<typeof vi.fn>;
const useProvider = (impl: RouteProvider['getRoute']) => {
  getRoute = vi.fn(impl);
  setRouteProvider({ getRoute } as RouteProvider);
};

beforeEach(() => {
  resetRouteCache();
  useProvider(async () => ROUTE);
});

describe('distanceMeters', () => {
  it('0,001° de latitud son ~111 m; el mismo punto, 0', () => {
    expect(distanceMeters(START, START)).toBe(0);
    expect(
      distanceMeters({ latitude: 22, longitude: -82 }, { latitude: 22.001, longitude: -82 }),
    ).toBeCloseTo(111, 0);
  });
});

describe('getRouteForOrder — nunca espera al motor de rutas', () => {
  it('la primera consulta responde null al instante y calcula en segundo plano; la siguiente ya trae la ruta', async () => {
    expect(getRouteForOrder('o1', START, DESTINATION, T0)).toBeNull();
    expect(getRoute).toHaveBeenCalledTimes(1);
    expect(getRoute).toHaveBeenCalledWith(START, DESTINATION);

    await settle();
    const route = getRouteForOrder('o1', START, DESTINATION, T0 + 8_000);
    expect(route).toMatchObject({ distanceMeters: 1797, coordinates: [START, DESTINATION] });
    expect(route?.computedAt).toEqual(new Date(T0));
  });

  it('no expone la duración (no hay ETA en esta versión)', async () => {
    getRouteForOrder('o1', START, DESTINATION, T0);
    await settle();
    const route = getRouteForOrder('o1', START, DESTINATION, T0 + 1_000);
    expect(route).not.toHaveProperty('durationSeconds');
    expect(JSON.stringify(route)).not.toContain('190');
  });

  it('una consulta lenta no bloquea: mientras el motor no responde, se devuelve null y no se dispara otra', async () => {
    let finish: (route: RouteResult) => void = () => undefined;
    useProvider(() => new Promise((resolve) => (finish = resolve)));

    expect(getRouteForOrder('o1', START, DESTINATION, T0)).toBeNull();
    expect(getRouteForOrder('o1', MOVED_FAR, DESTINATION, T0 + 60_000)).toBeNull();
    expect(getRoute).toHaveBeenCalledTimes(1); // una sola consulta en vuelo por pedido

    finish(ROUTE);
    await settle();
    expect(getRouteForOrder('o1', START, DESTINATION, T0 + 61_000)).not.toBeNull();
  });
});

describe('getRouteForOrder — cuándo se recalcula', () => {
  beforeEach(async () => {
    getRouteForOrder('o1', START, DESTINATION, T0);
    await settle();
    getRoute.mockClear();
  });

  it('no más de una consulta cada 15 s aunque el mensajero se mueva mucho', () => {
    getRouteForOrder('o1', MOVED_FAR, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS - 1);
    expect(getRoute).not.toHaveBeenCalled();
  });

  it('se recalcula si el mensajero se movió ≥100 m (y pasó el intervalo mínimo)', () => {
    getRouteForOrder('o1', MOVED_FAR, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS);
    expect(getRoute).toHaveBeenCalledTimes(1);
  });

  it('con movimientos pequeños (<100 m) y ruta reciente no consulta de nuevo', () => {
    getRouteForOrder('o1', MOVED_LITTLE, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS + 5_000);
    expect(getRoute).not.toHaveBeenCalled();
  });

  it('aunque casi no se mueva, se refresca al cumplirse el máximo de antigüedad (60 s)', () => {
    getRouteForOrder('o1', MOVED_LITTLE, DESTINATION, T0 + ROUTE_MAX_AGE_MS);
    expect(getRoute).toHaveBeenCalledTimes(1);
  });

  it('mientras se recalcula sigue sirviendo la ruta anterior', () => {
    useProvider(() => new Promise(() => undefined)); // nunca responde
    getRouteForOrder('o1', MOVED_FAR, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS);
    expect(
      getRouteForOrder('o1', MOVED_FAR, DESTINATION, T0 + ROUTE_MIN_INTERVAL_MS + 1_000),
    ).not.toBeNull();
  });

  it('cambiar el destino descarta la ruta vieja y calcula una nueva', () => {
    const otherDestination = { latitude: 22.8, longitude: -82.49 };
    expect(getRouteForOrder('o1', START, otherDestination, T0 + 1_000)).toBeNull();
    expect(getRoute).toHaveBeenCalledWith(START, otherDestination);
  });

  it('una ruta demasiado vieja (el motor lleva rato fallando) deja de mostrarse', async () => {
    useProvider(async () => null);
    const late = T0 + ROUTE_DISCARD_AFTER_MS + 1;
    expect(getRouteForOrder('o1', START, DESTINATION, late)).toBeNull();
  });

  it('cada pedido tiene su propia ruta: no se mezclan', async () => {
    const other: RouteResult = { ...ROUTE, distanceMeters: 5000 };
    useProvider(async () => other);
    getRouteForOrder('o2', START, DESTINATION, T0);
    await settle();
    expect(getRouteForOrder('o2', START, DESTINATION, T0 + 1_000)?.distanceMeters).toBe(5000);
    expect(getRouteForOrder('o1', START, DESTINATION, T0 + 1_000)?.distanceMeters).toBe(1797);
  });
});

describe('getRouteForOrder — fallos del motor de rutas', () => {
  it('si no hay ruta devuelve null, sin lanzar, y espera 30 s antes de reintentar', async () => {
    useProvider(async () => null);
    expect(getRouteForOrder('o1', START, DESTINATION, T0)).toBeNull();
    await settle();
    getRoute.mockClear();

    getRouteForOrder('o1', START, DESTINATION, T0 + ROUTE_FAILURE_BACKOFF_MS - 1);
    expect(getRoute).not.toHaveBeenCalled();
    getRouteForOrder('o1', START, DESTINATION, T0 + ROUTE_FAILURE_BACKOFF_MS);
    expect(getRoute).toHaveBeenCalledTimes(1);
  });

  it('si el proveedor lanza una excepción, tampoco afecta: solo "sin ruta"', async () => {
    useProvider(async () => {
      throw new Error('boom');
    });
    expect(() => getRouteForOrder('o1', START, DESTINATION, T0)).not.toThrow();
    await settle();
    expect(getRouteForOrder('o1', START, DESTINATION, T0 + 1_000)).toBeNull();
  });

  it('cuando el motor se recupera, la ruta aparece', async () => {
    useProvider(async () => null);
    getRouteForOrder('o1', START, DESTINATION, T0);
    await settle();

    useProvider(async () => ROUTE);
    getRouteForOrder('o1', START, DESTINATION, T0 + ROUTE_FAILURE_BACKOFF_MS);
    await settle();
    expect(
      getRouteForOrder('o1', START, DESTINATION, T0 + ROUTE_FAILURE_BACKOFF_MS + 1_000),
    ).not.toBeNull();
  });
});

describe('forgetRoute', () => {
  it('al terminar el seguimiento no queda nada guardado: la siguiente consulta empieza de cero', async () => {
    getRouteForOrder('o1', START, DESTINATION, T0);
    await settle();
    forgetRoute('o1');
    getRoute.mockClear();

    expect(getRouteForOrder('o1', START, DESTINATION, T0 + 1_000)).toBeNull();
    expect(getRoute).toHaveBeenCalledTimes(1);
  });
});

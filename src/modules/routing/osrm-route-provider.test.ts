import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OsrmRouteProvider } from './osrm-route-provider';

const FROM = { latitude: 22.8066, longitude: -82.513 };
const TO = { latitude: 22.7958, longitude: -82.5065 };

function osrmOk(coordinates: [number, number][], distance = 1797.4, duration = 190.2) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 'Ok', routes: [{ distance, duration, geometry: { coordinates } }] }),
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OsrmRouteProvider', () => {
  it('consulta la API de OSRM con longitud primero y geometría simplificada, identificándose', async () => {
    fetchMock.mockResolvedValue(
      osrmOk([
        [-82.513, 22.8066],
        [-82.5065, 22.7958],
      ]),
    );
    await new OsrmRouteProvider('https://osrm.example/').getRoute(FROM, TO);

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(
      'https://osrm.example/route/v1/driving/-82.513,22.8066;-82.5065,22.7958?overview=simplified&geometries=geojson&steps=false',
    );
    expect(init.headers['user-agent']).toMatch(/Traelo/);
  });

  it('convierte [lng, lat] de OSRM a { latitude, longitude }, redondea y entrega distancia y duración enteras', async () => {
    fetchMock.mockResolvedValue(
      osrmOk([
        [-82.5130123456, 22.8066987654],
        [-82.5065, 22.7958],
      ]),
    );
    // Origen y destino prácticamente sobre la calle (< 3 m): no se añade ningún tramo de enlace.
    const from = { latitude: 22.8067, longitude: -82.51301 };
    const route = await new OsrmRouteProvider('https://osrm.example').getRoute(from, TO);

    expect(route).toEqual({
      coordinates: [
        { latitude: 22.8067, longitude: -82.51301 },
        { latitude: 22.7958, longitude: -82.5065 },
      ],
      distanceMeters: 1797,
      durationSeconds: 190,
    });
  });

  it('OSRM pega el origen y el destino a la calle: la ruta los une con sus puntos reales y suma esos tramos', async () => {
    // La calle más cercana queda a ~110 m al norte del mensajero y ~110 m al sur del pin.
    const from = { latitude: 22.8, longitude: -82.5 };
    const to = { latitude: 22.79, longitude: -82.49 };
    fetchMock.mockResolvedValue(
      osrmOk(
        [
          [-82.5, 22.801],
          [-82.49, 22.789],
        ],
        2000,
      ),
    );
    const route = await new OsrmRouteProvider('https://osrm.example').getRoute(from, to);

    expect(route?.coordinates).toEqual([
      from,
      { latitude: 22.801, longitude: -82.5 },
      { latitude: 22.789, longitude: -82.49 },
      to,
    ]);
    // 2000 m de OSRM + ~111 m + ~111 m de enlace.
    expect(route?.distanceMeters).toBeGreaterThan(2200);
    expect(route?.distanceMeters).toBeLessThan(2240);
  });

  it('la línea empieza exactamente en el mensajero y termina exactamente en el destino', async () => {
    fetchMock.mockResolvedValue(
      osrmOk([
        [-82.5125, 22.8066],
        [-82.5066, 22.7959],
      ]),
    );
    const route = await new OsrmRouteProvider('https://osrm.example').getRoute(FROM, TO);
    expect(route?.coordinates[0]).toEqual(FROM);
    expect(route?.coordinates[route.coordinates.length - 1]).toEqual(TO);
  });

  it('una ruta larguísima se reduce a 150 puntos conservando el primero y el último', async () => {
    const coordinates = Array.from(
      { length: 1000 },
      (_, index) => [-82.5 + index * 1e-4, 22.8 - index * 1e-4] as [number, number],
    );
    const route = await (async () => {
      fetchMock.mockResolvedValue(osrmOk(coordinates));
      // from/to coinciden con los extremos de la ruta: solo se comprueba el recorte a 150 puntos.
      return new OsrmRouteProvider('https://osrm.example').getRoute(
        { latitude: 22.8, longitude: -82.5 },
        { latitude: 22.7001, longitude: -82.4001 },
      );
    })();

    expect(route?.coordinates).toHaveLength(150);
    expect(route?.coordinates[0]).toEqual({ latitude: 22.8, longitude: -82.5 });
    expect(route?.coordinates[149]).toEqual({ latitude: 22.7001, longitude: -82.4001 });
  });

  it.each([
    [
      'OSRM no encuentra ruta',
      { ok: true, status: 200, json: async () => ({ code: 'NoRoute', routes: [] }) },
    ],
    ['respuesta HTTP 500', { ok: false, status: 500, json: async () => ({}) }],
    ['geometría con menos de 2 puntos', osrmOk([[-82.5, 22.8]])],
    ['cuerpo sin rutas', { ok: true, status: 200, json: async () => ({ code: 'Ok' }) }],
  ])('devuelve null sin lanzar: %s', async (_label, response) => {
    fetchMock.mockResolvedValue(response);
    await expect(
      new OsrmRouteProvider('https://osrm.example').getRoute(FROM, TO),
    ).resolves.toBeNull();
  });

  it('un fallo de red o un timeout devuelve null sin lanzar', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      new OsrmRouteProvider('https://osrm.example').getRoute(FROM, TO),
    ).resolves.toBeNull();

    fetchMock.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    await expect(
      new OsrmRouteProvider('https://osrm.example').getRoute(FROM, TO),
    ).resolves.toBeNull();
  });

  it('una respuesta que no es JSON válido también devuelve null', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });
    await expect(
      new OsrmRouteProvider('https://osrm.example').getRoute(FROM, TO),
    ).resolves.toBeNull();
  });
});

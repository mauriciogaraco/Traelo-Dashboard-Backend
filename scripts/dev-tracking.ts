/* eslint-disable no-console */
// Herramienta de DESARROLLO para probar de punta a punta pedidos y seguimiento en vivo con un
// negocio y un producto de prueba, SIN tocar producción.
//
//   npx tsx scripts/dev-tracking.ts setup                 negocio TEST 24h + producto + mensajero de prueba
//   npx tsx scripts/dev-tracking.ts list                  últimos pedidos y ubicación de los mensajeros
//   npx tsx scripts/dev-tracking.ts assign <orderId>      asigna el pedido al mensajero de prueba (staff)
//   npx tsx scripts/dev-tracking.ts simulate [--order <orderId>] [--from lat,lng] [--to lat,lng]
//                                             [--steps 40] [--interval 5] [--straight] [--detour] [--no-complete]
//                                                         el mensajero "camina" hacia el destino (por la ruta real de
//                                                         calles; --straight = en línea recta) enviando su ubicación
//   npx tsx scripts/dev-tracking.ts pickup <orderId>      etapa "Recogiendo": el mensajero va por el pedido (el cliente ve el seguimiento desde aquí)
//   npx tsx scripts/dev-tracking.ts ontheway <orderId>   etapa "En camino": ya lo lleva al cliente
//   npx tsx scripts/dev-tracking.ts complete <orderId>    entrega el pedido (termina el seguimiento)
//   npx tsx scripts/dev-tracking.ts cancel <orderId>
//
// `setup` ESCRIBE en la base de datos: por seguridad solo corre si DATABASE_URL apunta a localhost.
// El resto de comandos usan la API real (--api, por defecto http://127.0.0.1:3000).
import bcrypt from 'bcrypt';
import { env } from '../src/config/env';
import { prisma } from '../src/shared/prisma';
import { bumpCatalogVersion } from '../src/shared/catalog/bump-catalog-version';
import { OsrmRouteProvider } from '../src/modules/routing/osrm-route-provider';
import { distanceMeters } from '../src/modules/routing/routing.service';

const TEST_BUSINESS_NAME = '🧪 TEST 24h — Negocio de prueba';
const TEST_PRODUCT_NAME = 'Producto de prueba';
const COURIER = {
  name: 'Mensajero de Prueba',
  email: 'courier@traelo.test',
  password: 'Courier-Test-2026!',
  phone: '+53 5555 0100',
};
const OWNER = {
  email: process.env.SEED_OWNER_EMAIL ?? 'owner@traelo.test',
  password: process.env.SEED_OWNER_PASSWORD ?? 'Owner-Test-2026!',
};
// Güines (centro aproximado de la zona de servicio).
const DEFAULT_DESTINATION = { latitude: 22.7958, longitude: -82.5065 };

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parsePoint(value: string | undefined): { latitude: number; longitude: number } | null {
  if (!value) return null;
  const [latitude, longitude] = value.split(',').map(Number);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude: latitude as number, longitude: longitude as number }
    : null;
}

function assertLocalDatabase(): void {
  const host = new URL(env.DATABASE_URL).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error(
      `❌ Me niego a escribir: DATABASE_URL apunta a "${host}", que no es local. Este script es solo para bases de desarrollo locales.`,
    );
    process.exit(1);
  }
}

const API = (arg('--api') ?? 'http://127.0.0.1:3000').replace(/\/+$/, '') + '/api/v1';

async function call<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: T | null; code?: string }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as { data?: T; code?: string }) : {};
  return { status: response.status, data: (json.data ?? null) as T | null, code: json.code };
}

async function login(email: string, password: string): Promise<string> {
  const result = await call<{ accessToken: string }>('POST', '/auth/login', { email, password });
  if (!result.data?.accessToken) {
    console.error(
      `❌ No se pudo iniciar sesión como ${email} (${result.status} ${result.code ?? ''}). ¿Corriste "setup" y el seed?`,
    );
    process.exit(1);
  }
  return result.data.accessToken;
}

async function setup(): Promise<void> {
  assertLocalDatabase();

  const category = await prisma.category.findUnique({ where: { slug: 'comida-rapida' } });

  let business = await prisma.business.findFirst({ where: { name: TEST_BUSINESS_NAME } });
  if (!business) {
    // Sin id explícito: el checkout exige ids en formato cuid y los del seed demo no lo son.
    business = await prisma.business.create({
      data: {
        name: TEST_BUSINESS_NAME,
        phone: '+53 5555 9999',
        address: 'Calle de Prueba #1, Güines',
        commissionType: 'PERCENTAGE',
        commissionPercentage: 10,
        deliveryFeeBase: 250,
      },
    });
  } else {
    business = await prisma.business.update({
      where: { id: business.id },
      data: { active: true, acceptingOrders: true },
    });
  }

  // Abierto las 24 h todos los días (hora de La Habana), para poder probar a cualquier hora.
  await Promise.all(
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) =>
      prisma.businessHours.upsert({
        where: { businessId_dayOfWeek: { businessId: business.id, dayOfWeek } },
        update: {
          openTime: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)),
          closeTime: new Date(Date.UTC(1970, 0, 1, 23, 59, 59)),
          closed: false,
        },
        create: {
          businessId: business.id,
          dayOfWeek,
          openTime: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)),
          closeTime: new Date(Date.UTC(1970, 0, 1, 23, 59, 59)),
          closed: false,
        },
      }),
    ),
  );

  let product = await prisma.product.findFirst({
    where: { businessId: business.id, name: TEST_PRODUCT_NAME },
  });
  if (!product) {
    product = await prisma.product.create({
      data: {
        businessId: business.id,
        name: TEST_PRODUCT_NAME,
        description: 'Producto para probar pedidos y seguimiento',
        categoryId: category?.id,
        price: 100,
        available: true,
      },
    });
  } else {
    product = await prisma.product.update({
      where: { id: product.id },
      data: { available: true, active: true, price: 100 },
    });
  }

  const passwordHash = await bcrypt.hash(COURIER.password, 12);
  const user = await prisma.user.upsert({
    where: { email: COURIER.email },
    update: { active: true },
    create: {
      name: COURIER.name,
      email: COURIER.email,
      passwordHash,
      phone: COURIER.phone,
      role: 'DELIVERER',
    },
  });
  const deliverer = await prisma.deliverer.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  // Que la app (bootstrap/sync) vea lo nuevo.
  await bumpCatalogVersion('BUSINESS', business.id);
  await bumpCatalogVersion('PRODUCT', product.id);

  console.log('✅ Entorno de prueba listo');
  console.log(`   Negocio : ${business.name}  (${business.id})`);
  console.log(`   Producto: ${product.name} — 100 CUP  (${product.id})`);
  console.log(`   Mensajero: ${COURIER.email} / ${COURIER.password}  (deliverer ${deliverer.id})`);
  console.log(`   Staff   : ${OWNER.email} / ${OWNER.password}`);
}

async function list(): Promise<void> {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { deliverer: { include: { user: { select: { name: true } } } } },
  });
  if (orders.length === 0) console.log('(no hay pedidos todavía)');
  for (const order of orders) {
    const pin =
      order.destinationLatitude !== null && order.destinationLongitude !== null
        ? `📍 ${order.destinationLatitude},${order.destinationLongitude}`
        : 'sin pin';
    console.log(
      `#${order.orderNumber}  ${order.status.padEnd(9)}  ${order.id}  ${order.deliverer?.user.name ?? 'sin mensajero'}  ${pin}  ${order.customerAddress}`,
    );
  }
  const locations = await prisma.delivererLocation.findMany();
  for (const location of locations) {
    console.log(
      `   ubicación mensajero ${location.delivererId}: ${location.latitude},${location.longitude} (${location.updatedAt.toISOString()})`,
    );
  }
}

async function setStage(orderId: string, stage: 'PICKING_UP' | 'ON_THE_WAY'): Promise<void> {
  const token = await login(COURIER.email, COURIER.password);
  const result = await call('PATCH', `/orders/${orderId}/stage`, { stage }, token);
  console.log(
    result.status === 200
      ? `✅ Etapa ${stage === 'PICKING_UP' ? 'Recogiendo' : 'En camino'} marcada en el pedido ${orderId}`
      : `❌ No se pudo marcar la etapa (${result.status} ${result.code ?? ''})`,
  );
}

async function assign(orderId: string): Promise<void> {
  const deliverer = await prisma.deliverer.findFirst({ where: { user: { email: COURIER.email } } });
  if (!deliverer) {
    console.error('❌ No existe el mensajero de prueba: corre "setup".');
    process.exit(1);
  }
  const token = await login(OWNER.email, OWNER.password);
  const result = await call(
    'PATCH',
    `/orders/${orderId}/assign`,
    { delivererId: deliverer.id },
    token,
  );
  console.log(
    result.status === 200
      ? `✅ Pedido asignado a ${COURIER.name}`
      : `❌ ${result.status} ${result.code ?? ''}`,
  );
}

async function finish(orderId: string, status: 'COMPLETED' | 'CANCELLED'): Promise<void> {
  const token = await login(OWNER.email, OWNER.password);
  const result = await call('PATCH', `/orders/${orderId}/status`, { status }, token);
  console.log(
    result.status === 200 ? `✅ Pedido ${status}` : `❌ ${result.status} ${result.code ?? ''}`,
  );
}

// `steps + 1` puntos repartidos a distancias iguales a lo largo de la polilínea.
function pointsAlong(
  path: { latitude: number; longitude: number }[],
  steps: number,
): { latitude: number; longitude: number }[] {
  const cumulative = [0];
  for (let i = 1; i < path.length; i += 1) {
    cumulative.push(
      (cumulative[i - 1] as number) + distanceMeters(path[i - 1] as never, path[i] as never),
    );
  }
  const total = cumulative[cumulative.length - 1] as number;
  return Array.from({ length: steps + 1 }, (_, step) => {
    const target = (total * step) / steps;
    let segment = 1;
    while (segment < path.length - 1 && (cumulative[segment] as number) < target) segment += 1;
    const a = path[segment - 1] as { latitude: number; longitude: number };
    const b = path[segment] as { latitude: number; longitude: number };
    const span = (cumulative[segment] as number) - (cumulative[segment - 1] as number);
    const t =
      span === 0
        ? 1
        : Math.min(1, Math.max(0, (target - (cumulative[segment - 1] as number)) / span));
    return {
      latitude: a.latitude + (b.latitude - a.latitude) * t,
      longitude: a.longitude + (b.longitude - a.longitude) * t,
    };
  });
}

async function simulate(): Promise<void> {
  const orderId = arg('--order');
  let destination = parsePoint(arg('--to'));
  if (!destination && orderId) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (order?.destinationLatitude != null && order.destinationLongitude != null) {
      destination = { latitude: order.destinationLatitude, longitude: order.destinationLongitude };
    }
  }
  destination ??= DEFAULT_DESTINATION;
  // Sin --from, sale a ~1,5 km del destino.
  const from = parsePoint(arg('--from')) ?? {
    latitude: destination.latitude + 0.011,
    longitude: destination.longitude - 0.013,
  };
  const steps = Number(arg('--steps') ?? 40);
  const intervalSeconds = Number(arg('--interval') ?? 5);

  const token = await login(COURIER.email, COURIER.password);
  if (orderId) {
    // El seguimiento del cliente empieza en "Recogiendo": el mensajero sale por el pedido.
    const stage = await call('PATCH', `/orders/${orderId}/stage`, { stage: 'PICKING_UP' }, token);
    console.log(`   etapa Recogiendo → ${stage.status}`);
  }
  let onTheWayMarked = false;
  console.log(
    `🛵 Simulando recorrido de ${from.latitude.toFixed(5)},${from.longitude.toFixed(5)} a ${destination.latitude.toFixed(5)},${destination.longitude.toFixed(5)} (${steps} pasos cada ${intervalSeconds}s). Ctrl+C para detener.`,
  );

  // Por defecto camina por la ruta REAL de calles (la misma que dibuja la app); --straight = línea recta.
  const route = process.argv.includes('--straight')
    ? null
    : await new OsrmRouteProvider(env.ROUTING_BASE_URL).getRoute(from, destination);
  console.log(
    route
      ? `🛣️  Siguiendo la ruta por calles (${route.distanceMeters} m)`
      : '↔️  Línea recta (sin ruta por calles)',
  );
  const positions = pointsAlong(route?.coordinates ?? [from, destination], steps);

  for (let step = 0; step <= steps; step += 1) {
    const base = positions[step] as { latitude: number; longitude: number };
    // --detour: entre el 35 % y el 65 % del recorrido el mensajero se sale de la línea (~130 m hacia
    // el norte, como si tomara otra calle) y vuelve: sirve para ver cómo la ruta se recalcula.
    const progress = step / steps;
    if (orderId && !onTheWayMarked && progress >= 0.25) {
      // Recogió el pedido: ahora lo lleva al cliente.
      onTheWayMarked = true;
      const stage = await call('PATCH', `/orders/${orderId}/stage`, { stage: 'ON_THE_WAY' }, token);
      console.log(`   etapa En camino → ${stage.status}`);
    }
    const bump =
      process.argv.includes('--detour') && progress > 0.35 && progress < 0.65
        ? 0.0012 * Math.sin((Math.PI * (progress - 0.35)) / 0.3)
        : 0;
    const latitude = base.latitude + bump;
    const longitude = base.longitude;
    const result = await call(
      'POST',
      '/deliverers/me/location',
      { latitude, longitude, accuracy: 8 },
      token,
    );
    if (result.status === 409 && result.code === 'NO_ACTIVE_DELIVERY') {
      console.log(
        '⚠️  El mensajero no tiene entregas activas: asigna el pedido primero ("assign <orderId>").',
      );
      return;
    }
    console.log(
      `${String(step).padStart(3)}/${steps}  ${latitude.toFixed(5)},${longitude.toFixed(5)}  → ${result.status}`,
    );
    if (result.status >= 400) return;
    if (step < steps) await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
  console.log('🏁 Llegó al destino.');
  // Con --order el mensajero entrega al llegar (en producción lo marca su app): el cliente ve
  // "Entregado". --no-complete deja el pedido en camino.
  if (orderId && !process.argv.includes('--no-complete')) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await finish(orderId, 'COMPLETED');
  }
}

async function main(): Promise<void> {
  const [command, id] = process.argv.slice(2);
  switch (command) {
    case 'setup':
      return setup();
    case 'list':
      return list();
    case 'assign':
      return id ? assign(id) : Promise.reject(new Error('Falta <orderId>'));
    case 'pickup':
      return id ? setStage(id, 'PICKING_UP') : Promise.reject(new Error('Falta <orderId>'));
    case 'ontheway':
      return id ? setStage(id, 'ON_THE_WAY') : Promise.reject(new Error('Falta <orderId>'));
    case 'complete':
      return id ? finish(id, 'COMPLETED') : Promise.reject(new Error('Falta <orderId>'));
    case 'cancel':
      return id ? finish(id, 'CANCELLED') : Promise.reject(new Error('Falta <orderId>'));
    case 'simulate':
      return simulate();
    default:
      console.log(
        'Uso: setup | list | assign <orderId> | pickup <orderId> | ontheway <orderId> | simulate [--order id] [--from lat,lng] [--to lat,lng] [--steps n] [--interval s] [--no-complete] | complete <orderId> | cancel <orderId>',
      );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { ForbiddenError, NotFoundError } from '../../shared/errors';
import type { OrderStatus } from '../../generated/prisma/enums';
import * as customersService from '../customers/customers.service';
import * as ordersRepository from '../orders/orders.repository';
import type { OrderWithRelations } from '../orders/orders.repository';
import * as locationRepository from './deliverer-location.repository';
import { LOCATION_MAX_AGE_MS } from './tracking.constants';
import { forgetRoute, getRouteForOrder, type OrderRouteDTO } from '../routing/routing.service';

// Lo único que el cliente necesita para seguir su pedido. A propósito NO incluye el id ni el
// teléfono del mensajero, otros pedidos, histórico de posiciones ni datos financieros.
export interface OrderTrackingDTO {
  orderId: string;
  orderNumber: number;
  status: OrderStatus;
  // true solo mientras el pedido está ASSIGNED con mensajero Y el mensajero ya va por el pedido
  // (etapa "Recogiendo" o posterior). Antes de eso (Confirmado) y en COMPLETED/CANCELLED es false y
  // no se entrega ninguna ubicación.
  trackingActive: boolean;
  // Etapas reportadas por el backend (null = todavía no). Sirven para pintar "Recogiendo"/"En camino".
  pickingUpAt: Date | null;
  onTheWayAt: Date | null;
  // Hora del servidor: la app calcula la antigüedad de la ubicación contra ESTA hora, no contra
  // el reloj del teléfono (que puede estar mal).
  serverTime: Date;
  deliverer: { name: string; photoUrl: string | null } | null;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    updatedAt: Date;
  } | null;
  // Recorrido por calles del mensajero al destino y su distancia. null si no hay (sin pin de
  // destino, sin ubicación del mensajero, o el motor de rutas todavía no respondió / falló): el
  // seguimiento funciona igual y la app dibuja, a lo sumo, una línea recta de respaldo.
  route: OrderRouteDTO | null;
  // Snapshot del pedido — nunca la dirección actual del perfil. Las coordenadas son null si la
  // dirección no se pudo ubicar en el mapa.
  destination: {
    address: string;
    reference: string | null;
    latitude: number | null;
    longitude: number | null;
  };
}

async function loadOrder(orderId: string): Promise<OrderWithRelations> {
  const order = await ordersRepository.findById(orderId);
  if (!order) {
    throw new NotFoundError('Pedido no encontrado', 'ORDER_NOT_FOUND');
  }
  return order;
}

async function buildTracking(order: OrderWithRelations, now: Date): Promise<OrderTrackingDTO> {
  const trackingActive =
    order.status === 'ASSIGNED' && order.delivererId !== null && order.pickingUpAt !== null;

  let location: OrderTrackingDTO['location'] = null;
  if (trackingActive && order.delivererId) {
    const stored = await locationRepository.findByDelivererId(order.delivererId);
    if (stored && now.getTime() - stored.updatedAt.getTime() <= LOCATION_MAX_AGE_MS) {
      location = {
        latitude: stored.latitude,
        longitude: stored.longitude,
        accuracy: stored.accuracy,
        updatedAt: stored.updatedAt,
      };
    }
  }

  // Ruta: solo con seguimiento activo, ubicación del mensajero y pin de destino. Se lee de una
  // caché y se refresca en segundo plano (ver routing.service): esto nunca espera al motor de rutas.
  let route: OrderRouteDTO | null = null;
  if (!trackingActive) {
    forgetRoute(order.id);
  } else if (
    location &&
    order.destinationLatitude !== null &&
    order.destinationLongitude !== null
  ) {
    route = getRouteForOrder(
      order.id,
      { latitude: location.latitude, longitude: location.longitude },
      { latitude: order.destinationLatitude, longitude: order.destinationLongitude },
      now.getTime(),
    );
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    trackingActive,
    pickingUpAt: order.pickingUpAt,
    onTheWayAt: order.onTheWayAt,
    serverTime: now,
    deliverer:
      trackingActive && order.deliverer
        ? { name: order.deliverer.user.name, photoUrl: order.deliverer.photoUrl ?? null }
        : null,
    location,
    route,
    destination: {
      address: order.customerAddress,
      reference: order.addressReference,
      latitude: order.destinationLatitude,
      longitude: order.destinationLongitude,
    },
  };
}

// Cliente con cuenta: solo puede ver el seguimiento de SUS pedidos (mismo criterio que
// GET /customers/me/orders/:orderId — un pedido ajeno responde 403).
export async function getCustomerOrderTracking(
  customerId: string,
  orderId: string,
  now: Date = new Date(),
): Promise<OrderTrackingDTO> {
  await customersService.assertCustomerExists(customerId);
  const order = await loadOrder(orderId);
  if (order.customerId !== customerId) {
    throw new ForbiddenError();
  }
  return buildTracking(order, now);
}

// Invitado: la autorización (token del pedido) ya la hizo authenticateGuestOrder antes de llegar
// acá; solo se llama con el id de ESE pedido.
export async function getGuestOrderTracking(
  orderId: string,
  now: Date = new Date(),
): Promise<OrderTrackingDTO> {
  return buildTracking(await loadOrder(orderId), now);
}

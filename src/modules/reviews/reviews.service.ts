import { ConflictError, BadRequestError, NotFoundError } from '../../shared/errors';
import { decimalToNumber } from '../../shared/prisma';
import { sendTelegramMessage } from '../../shared/telegram';
import { Prisma } from '../../generated/prisma/client';
import * as repository from './reviews.repository';
import type { OrderForReview } from './reviews.repository';
import type { BusinessReviewsInput, DelivererReviewInput, OrderCommentInput } from './reviews.dto';

// Quién pide. La AUTORIZACIÓN sobre el pedido ya la resolvió la ruta:
//  - customer: el id sale del token verificado (rutas /customers/:id/..., :id = el del token);
//  - guest: el token X-Guest-Token ya se validó contra ESTE pedido (authenticateGuestOrder).
// Aun así, para un cliente se vuelve a comprobar aquí que el pedido sea suyo (defensa en
// profundidad: este servicio nunca debería poder valorar el pedido de otra cuenta).
export type ReviewAccess = { kind: 'customer'; customerId: string } | { kind: 'guest' };

// Ventana en la que un pedido completado sigue apareciendo como "pendiente de valorar".
export const PENDING_REVIEW_WINDOW_DAYS = 14;
const PENDING_REVIEW_MAX_ORDERS = 20;

export type ReviewStatus = 'pending' | 'submitted';

export interface DelivererReviewStateDTO {
  delivererName: string;
  status: ReviewStatus;
  rating: number | null;
}

export interface BusinessReviewStateDTO {
  businessId: string;
  businessName: string;
  status: ReviewStatus;
  rating: number | null;
}

// El estado pending/submitted lo decide SIEMPRE el backend; la app no lo infiere.
export interface OrderReviewStateDTO {
  orderId: string;
  orderNumber: number;
  // Solo un pedido COMPLETED admite valoración.
  canReview: boolean;
  // null si el pedido no tiene (o todavía no tiene) mensajero asignado.
  deliverer: DelivererReviewStateDTO | null;
  businesses: BusinessReviewStateDTO[];
  // true si canReview y falta al menos una valoración.
  hasPending: boolean;
}

export interface PendingReviewDTO {
  orderId: string;
  orderNumber: number;
  completedAt: Date | null;
  delivererPending: { delivererName: string } | null;
  businessesPending: { businessId: string; businessName: string }[];
}

export interface RatingSummaryDTO {
  // null mientras no haya reseñas.
  average: number | null;
  count: number;
}

const orderNotFound = () => new NotFoundError('Pedido no encontrado', 'ORDER_NOT_FOUND');
const alreadySubmitted = () =>
  new ConflictError('Ya enviaste tu valoración para este pedido', 'REVIEW_ALREADY_SUBMITTED');

async function loadOrder(access: ReviewAccess, orderId: string): Promise<OrderForReview> {
  const order = await repository.findOrderForReview(orderId);
  if (!order) {
    throw orderNotFound();
  }
  if (access.kind === 'customer') {
    // 404 (no 403) para un pedido ajeno: no confirmar que ese pedido existe.
    if (order.customerId !== access.customerId) {
      throw orderNotFound();
    }
  } else if (order.customerId !== null) {
    // Un pedido de cuenta jamás se valora por la vía de invitado.
    throw orderNotFound();
  }
  return order;
}

function assertCompleted(order: OrderForReview): void {
  if (order.status !== 'COMPLETED') {
    throw new ConflictError('Solo puedes valorar un pedido ya entregado', 'ORDER_NOT_COMPLETED');
  }
}

function businessNameOf(business: OrderForReview['businesses'][number]): string {
  return business.businessNameSnapshot ?? business.business.name;
}

function buildState(order: OrderForReview): OrderReviewStateDTO {
  const canReview = order.status === 'COMPLETED';
  const ratingByBusiness = new Map(
    order.businessReviews.map((review) => [review.businessId, decimalToNumber(review.rating)]),
  );

  const deliverer: DelivererReviewStateDTO | null =
    order.delivererId && order.deliverer
      ? {
          delivererName: order.deliverer.user.name,
          status: order.delivererReview ? 'submitted' : 'pending',
          rating: order.delivererReview ? decimalToNumber(order.delivererReview.rating) : null,
        }
      : null;

  const businesses: BusinessReviewStateDTO[] = order.businesses.map((business) => {
    const rating = ratingByBusiness.get(business.businessId);
    return {
      businessId: business.businessId,
      businessName: businessNameOf(business),
      status: rating === undefined ? 'pending' : 'submitted',
      rating: rating ?? null,
    };
  });

  const hasPending =
    canReview &&
    (deliverer?.status === 'pending' ||
      businesses.some((business) => business.status === 'pending'));

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    canReview,
    deliverer,
    businesses,
    hasPending,
  };
}

export async function getOrderReviews(
  access: ReviewAccess,
  orderId: string,
): Promise<OrderReviewStateDTO> {
  return buildState(await loadOrder(access, orderId));
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// Valora al mensajero del pedido. El mensajero NUNCA viene del cliente: se toma de
// order.delivererId.
export async function submitDelivererReview(
  access: ReviewAccess,
  orderId: string,
  input: DelivererReviewInput,
): Promise<OrderReviewStateDTO> {
  const order = await loadOrder(access, orderId);
  assertCompleted(order);

  if (!order.delivererId) {
    throw new ConflictError('Este pedido no tuvo mensajero asignado', 'NO_DELIVERER');
  }
  if (order.delivererReview) {
    throw alreadySubmitted();
  }

  try {
    await repository.createDelivererReview({
      orderId: order.id,
      delivererId: order.delivererId,
      customerId: access.kind === 'customer' ? access.customerId : null,
      rating: input.rating,
    });
  } catch (error) {
    // Dos envíos simultáneos: el unique de la BD (orderId) decide.
    if (isUniqueViolation(error)) {
      throw alreadySubmitted();
    }
    throw error;
  }

  return getOrderReviews(access, orderId);
}

// Valora uno o varios negocios de un pedido (varios si fue multi-negocio). Se valida TODO antes
// de escribir y la escritura es atómica: o se guardan todas o ninguna.
export async function submitBusinessReviews(
  access: ReviewAccess,
  orderId: string,
  input: BusinessReviewsInput,
): Promise<OrderReviewStateDTO> {
  const order = await loadOrder(access, orderId);
  assertCompleted(order);

  const businessIdsInOrder = new Set(order.businesses.map((business) => business.businessId));
  const notInOrder = input.reviews.filter((review) => !businessIdsInOrder.has(review.businessId));
  if (notInOrder.length > 0) {
    throw new BadRequestError(
      'Alguno de los negocios no forma parte de este pedido',
      'BUSINESS_NOT_IN_ORDER',
      { businessIds: notInOrder.map((review) => review.businessId) },
    );
  }

  const alreadyReviewed = new Set(order.businessReviews.map((review) => review.businessId));
  if (input.reviews.some((review) => alreadyReviewed.has(review.businessId))) {
    throw alreadySubmitted();
  }

  try {
    await repository.createBusinessReviews(
      order.id,
      access.kind === 'customer' ? access.customerId : null,
      input.reviews,
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw alreadySubmitted();
    }
    throw error;
  }

  return getOrderReviews(access, orderId);
}

// Opinión libre y opcional sobre el pedido (checklist: "que se sienta ligero, no obligatorio").
// A diferencia de las valoraciones por estrellas, no se guarda en la base de datos: se manda tal
// cual al grupo de Telegram del equipo, identificada SOLO por orderId/orderNumber — nunca con
// nombre/teléfono/dirección del cliente. Quien lea el mensaje busca el pedido en el dashboard si
// necesita el contacto. Nunca lanza si Telegram falla: sendTelegramMessage ya se traga sus
// propios errores.
export async function submitOrderComment(
  access: ReviewAccess,
  orderId: string,
  input: OrderCommentInput,
): Promise<void> {
  const order = await loadOrder(access, orderId);
  assertCompleted(order);

  await sendTelegramMessage(
    `Opinión del pedido #${order.orderNumber} (${order.id}): ${input.comment}`,
  );
}

// Pedidos completados recientes de un cliente a los que todavía les falta alguna valoración
// (la app los usa para invitar a valorar sin bloquear nada). Los invitados no tienen esta
// lista: su pedido se consulta por token.
export async function listPendingReviews(
  customerId: string,
  now = new Date(),
): Promise<PendingReviewDTO[]> {
  const since = new Date(now.getTime() - PENDING_REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const orders = await repository.findOrdersPendingReview(
    customerId,
    since,
    PENDING_REVIEW_MAX_ORDERS,
  );

  return orders.map((order) => ({
    orderId: order.id,
    orderNumber: order.orderNumber,
    completedAt: order.completedAt,
    delivererPending:
      order.delivererId && order.deliverer && !order.delivererReview
        ? { delivererName: order.deliverer.user.name }
        : null,
    businessesPending: order.businesses
      .filter((business) => !business.review)
      .map((business) => ({
        businessId: business.businessId,
        businessName: business.businessNameSnapshot ?? business.business.name,
      })),
  }));
}

// Promedio y cantidad de reseñas. Solo datos; sin rankings ni gamificación.
function toSummary(aggregate: {
  _avg: { rating: Prisma.Decimal | null };
  _count: { _all: number };
}): RatingSummaryDTO {
  const average = aggregate._avg.rating;
  return {
    average: average === null ? null : Math.round(decimalToNumber(average) * 100) / 100,
    count: aggregate._count._all,
  };
}

export async function getDelivererRatingSummary(delivererId: string): Promise<RatingSummaryDTO> {
  return toSummary(await repository.aggregateDelivererRating(delivererId));
}

export async function getBusinessRatingSummary(businessId: string): Promise<RatingSummaryDTO> {
  return toSummary(await repository.aggregateBusinessRating(businessId));
}

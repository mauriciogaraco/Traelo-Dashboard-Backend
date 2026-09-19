import type { Request, Response } from 'express';
import { sendCreated, sendOk } from '../../shared/http';
import * as reviewsService from './reviews.service';
import type { ReviewAccess } from './reviews.service';
import type { BusinessReviewsInput, DelivererReviewInput } from './reviews.dto';

// Mismos handlers para las dos vías de acceso: /customers/:id/orders/:orderId/reviews (cliente
// con cuenta; :id ya se verificó contra el token) y /guest/orders/:orderId/reviews (invitado con
// X-Guest-Token ya validado contra ese pedido).
function accessOf(req: Request): ReviewAccess {
  if (req.guestOrder) {
    return { kind: 'guest' };
  }
  return { kind: 'customer', customerId: (req.params as { id: string }).id };
}

function orderIdOf(req: Request): string {
  return (req.params as { orderId: string }).orderId;
}

export async function getOrderReviews(req: Request, res: Response): Promise<void> {
  sendOk(res, await reviewsService.getOrderReviews(accessOf(req), orderIdOf(req)));
}

export async function submitDelivererReview(req: Request, res: Response): Promise<void> {
  const state = await reviewsService.submitDelivererReview(
    accessOf(req),
    orderIdOf(req),
    req.body as DelivererReviewInput,
  );
  sendCreated(res, state);
}

export async function submitBusinessReviews(req: Request, res: Response): Promise<void> {
  const state = await reviewsService.submitBusinessReviews(
    accessOf(req),
    orderIdOf(req),
    req.body as BusinessReviewsInput,
  );
  sendCreated(res, state);
}

export async function listPendingReviews(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  sendOk(res, await reviewsService.listPendingReviews(id));
}

import type { NextFunction, Request, Response } from 'express';
import { NotFoundError, UnauthorizedError } from '../../shared/errors';
import * as ordersService from '../orders/orders.service';
import { GUEST_TOKEN_HEADER, hashGuestAccessToken } from './guest-token';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Pedido de invitado autorizado por el token (ver authenticateGuestOrder).
      guestOrder?: { id: string };
    }
  }
}

// Autoriza a un invitado sobre UN pedido concreto: el header X-Guest-Token debe ser el token
// de ese pedido (:orderId). Cualquier otra combinación — token inválido, de otro pedido, o un
// pedido que no es de invitado — responde igual (404), sin revelar si el pedido existe.
export async function authenticateGuestOrder(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.header(GUEST_TOKEN_HEADER);
  if (!token) {
    throw new UnauthorizedError('Token de invitado requerido', 'GUEST_TOKEN_REQUIRED');
  }

  const { orderId } = req.params as { orderId?: string };
  const order = await ordersService.findOrderByGuestAccessTokenHash(hashGuestAccessToken(token));
  if (!order || order.id !== orderId || order.customerId !== null) {
    throw new NotFoundError('Pedido no encontrado', 'ORDER_NOT_FOUND');
  }

  req.guestOrder = { id: order.id };
  next();
}

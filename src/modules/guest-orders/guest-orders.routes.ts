import { Router } from 'express';
import { z } from 'zod';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth';
import { publicRateLimit } from '../../middlewares/publicRateLimit';
import { validate } from '../../middlewares/validate';
import { sendOk } from '../../shared/http';
import * as ordersService from '../orders/orders.service';
import { toOrderStatusDTO } from '../customers/customer-orders.service';
import { orderReviewsRouter } from '../reviews/reviews.routes';
import { authenticateGuestOrder } from './authenticate-guest-order';

const guestOrderParamsSchema = z.object({ orderId: z.cuid('id de pedido inválido') });

// Seguimiento de un pedido hecho SIN cuenta. La autorización es la posesión del token que
// /checkout entregó al dispositivo (header X-Guest-Token): no depende del teléfono ni de
// ningún dato que otra persona pueda conocer.
export const guestOrdersRouter = Router();

guestOrdersRouter.use(publicRateLimit, apiKeyAuth);

guestOrdersRouter.use(
  '/:orderId',
  validate({ params: guestOrderParamsSchema }),
  authenticateGuestOrder,
);

guestOrdersRouter.get('/:orderId', async (req, res) => {
  const order = await ordersService.getOrderById(req.guestOrder?.id as string);
  sendOk(res, order);
});

guestOrdersRouter.get('/:orderId/status', async (req, res) => {
  const order = await ordersService.getOrderById(req.guestOrder?.id as string);
  sendOk(res, toOrderStatusDTO(order));
});

guestOrdersRouter.use('/:orderId/reviews', orderReviewsRouter);

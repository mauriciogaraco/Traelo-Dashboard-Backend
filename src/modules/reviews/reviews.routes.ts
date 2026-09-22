import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import * as controller from './reviews.controller';
import { businessReviewsSchema, delivererReviewSchema, orderCommentSchema } from './reviews.dto';

// Rutas de reseñas de UN pedido; se montan tanto bajo /customers/:id/orders/:orderId (cuenta)
// como bajo /guest/orders/:orderId (invitado). La autorización previa la hace quien las monta.
export const orderReviewsRouter = Router({ mergeParams: true });

orderReviewsRouter.get('/', controller.getOrderReviews);

orderReviewsRouter.post(
  '/deliverer',
  validate({ body: delivererReviewSchema }),
  controller.submitDelivererReview,
);

orderReviewsRouter.post(
  '/businesses',
  validate({ body: businessReviewsSchema }),
  controller.submitBusinessReviews,
);

orderReviewsRouter.post(
  '/comment',
  validate({ body: orderCommentSchema }),
  controller.submitOrderComment,
);

// GET /customers/:id/reviews/pending
export const customerReviewsRouter = Router({ mergeParams: true });

customerReviewsRouter.get('/pending', controller.listPendingReviews);

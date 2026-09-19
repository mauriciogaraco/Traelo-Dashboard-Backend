import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { customerIdParamSchema } from './customers.dto';
import { orderReviewsRouter } from '../reviews/reviews.routes';
import * as customerOrdersController from './customer-orders.controller';
import {
  createAppOrderSchema,
  customerOrderParamsSchema,
  listCustomerOrdersQuerySchema,
} from './customer-orders.dto';

export const customerOrdersRouter = Router({ mergeParams: true });

customerOrdersRouter.use(validate({ params: customerIdParamSchema }));

customerOrdersRouter.get(
  '/',
  validate({ query: listCustomerOrdersQuerySchema }),
  customerOrdersController.listOrders,
);

customerOrdersRouter.post(
  '/',
  validate({ body: createAppOrderSchema }),
  customerOrdersController.createOrder,
);

customerOrdersRouter.get(
  '/:orderId',
  validate({ params: customerOrderParamsSchema }),
  customerOrdersController.getOrder,
);

customerOrdersRouter.get(
  '/:orderId/status',
  validate({ params: customerOrderParamsSchema }),
  customerOrdersController.getOrderStatus,
);

customerOrdersRouter.post(
  '/:orderId/repeat',
  validate({ params: customerOrderParamsSchema }),
  customerOrdersController.repeatOrder,
);

customerOrdersRouter.use(
  '/:orderId/reviews',
  validate({ params: customerOrderParamsSchema }),
  orderReviewsRouter,
);

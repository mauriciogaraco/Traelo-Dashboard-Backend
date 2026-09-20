import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { customerIdParamSchema } from './customers.dto';
import { orderReviewsRouter } from '../reviews/reviews.routes';
import * as customerOrdersController from './customer-orders.controller';
import { sendOk } from '../../shared/http';
import * as trackingService from '../tracking/tracking.service';
import {
  createAppOrderSchema,
  customerOrderParamsSchema,
  listCustomerOrdersQuerySchema,
  type CustomerOrderParams,
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

// Seguimiento en vivo (ubicación del mensajero). Solo de pedidos propios: el id del cliente
// sale del token y el servicio comprueba que el pedido sea suyo.
customerOrdersRouter.get(
  '/:orderId/tracking',
  validate({ params: customerOrderParamsSchema }),
  async (req, res) => {
    const { id: customerId, orderId } = req.params as unknown as CustomerOrderParams;
    sendOk(res, await trackingService.getCustomerOrderTracking(customerId, orderId));
  },
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

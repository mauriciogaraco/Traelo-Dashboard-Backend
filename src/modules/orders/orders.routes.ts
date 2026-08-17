import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { idParamSchema } from '../../shared/http';
import { Role } from '../../generated/prisma/enums';
import * as ordersController from './orders.controller';
import {
  assignOrderSchema,
  createOrderSchema,
  listOrdersQuerySchema,
  updateOrderSchema,
  updateOrderStatusSchema,
} from './orders.dto';

export const ordersRouter = Router();

ordersRouter.use(authenticate);

ordersRouter.get(
  '/',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ query: listOrdersQuerySchema }),
  ordersController.listOrders,
);

ordersRouter.post(
  '/',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ body: createOrderSchema }),
  ordersController.createOrder,
);

ordersRouter.get(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ params: idParamSchema }),
  ordersController.getOrder,
);

ordersRouter.patch(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ params: idParamSchema, body: updateOrderSchema }),
  ordersController.updateOrder,
);

ordersRouter.delete(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: idParamSchema }),
  ordersController.deleteOrder,
);

ordersRouter.patch(
  '/:id/assign',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ params: idParamSchema, body: assignOrderSchema }),
  ordersController.assignOrder,
);

ordersRouter.patch(
  '/:id/status',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ params: idParamSchema, body: updateOrderStatusSchema }),
  ordersController.updateOrderStatus,
);

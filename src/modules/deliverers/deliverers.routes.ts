import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { idParamSchema } from '../../shared/http';
import { Role } from '../../generated/prisma/enums';
import * as deliverersController from './deliverers.controller';
import {
  createDelivererSchema,
  listDeliverersQuerySchema,
  updateDelivererSchema,
} from './deliverers.dto';

export const deliverersRouter = Router();

deliverersRouter.use(authenticate);

deliverersRouter.get('/me', deliverersController.getMyProfile);

deliverersRouter.get(
  '/',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ query: listDeliverersQuerySchema }),
  deliverersController.listDeliverers,
);

deliverersRouter.post(
  '/',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ body: createDelivererSchema }),
  deliverersController.createDeliverer,
);

deliverersRouter.get(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ params: idParamSchema }),
  deliverersController.getDeliverer,
);

deliverersRouter.patch(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: idParamSchema, body: updateDelivererSchema }),
  deliverersController.updateDeliverer,
);

deliverersRouter.delete(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: idParamSchema }),
  deliverersController.deactivateDeliverer,
);

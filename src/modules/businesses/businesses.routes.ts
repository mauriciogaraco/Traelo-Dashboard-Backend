import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { Role } from '../../generated/prisma/enums';
import * as businessesController from './businesses.controller';
import {
  businessIdParamSchema,
  createBusinessSchema,
  listBusinessesQuerySchema,
  updateBusinessSchema,
} from './businesses.dto';
import { productsRouter } from './products.routes';
import { subscriptionsRouter } from './subscriptions.routes';

export const businessesRouter = Router();

businessesRouter.use(authenticate);

businessesRouter.get(
  '/',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ query: listBusinessesQuerySchema }),
  businessesController.listBusinesses,
);

businessesRouter.post(
  '/',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ body: createBusinessSchema }),
  businessesController.createBusiness,
);

businessesRouter.get(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ params: businessIdParamSchema }),
  businessesController.getBusiness,
);

businessesRouter.patch(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: businessIdParamSchema, body: updateBusinessSchema }),
  businessesController.updateBusiness,
);

businessesRouter.delete(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: businessIdParamSchema }),
  businessesController.deactivateBusiness,
);

businessesRouter.use('/:id/products', productsRouter);
businessesRouter.use('/:id/subscriptions', subscriptionsRouter);

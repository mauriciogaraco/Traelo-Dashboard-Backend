import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { imageUpload } from '../../middlewares/imageUpload';
import { restrictBusinessOwnerToOwnBusiness } from '../../shared/business-scope';
import { Role } from '../../generated/prisma/enums';
import * as businessesController from './businesses.controller';
import {
  businessIdParamSchema,
  createBusinessSchema,
  listBusinessesQuerySchema,
  setAcceptingOrdersSchema,
  updateBusinessSchema,
} from './businesses.dto';
import { productsRouter } from './products.routes';
import { subscriptionsRouter } from './subscriptions.routes';
import { businessHoursRouter } from './business-hours.routes';
import { businessClosuresRouter } from './business-closures.routes';

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
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.BUSINESS_OWNER),
  restrictBusinessOwnerToOwnBusiness,
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

businessesRouter.patch(
  '/:id/accepting-orders',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.BUSINESS_OWNER),
  restrictBusinessOwnerToOwnBusiness,
  validate({ params: businessIdParamSchema, body: setAcceptingOrdersSchema }),
  businessesController.setAcceptingOrders,
);

businessesRouter.post(
  '/:id/logo',
  authorize(Role.OWNER, Role.ADMIN, Role.BUSINESS_OWNER),
  restrictBusinessOwnerToOwnBusiness,
  validate({ params: businessIdParamSchema }),
  imageUpload.single('image'),
  businessesController.setLogo,
);

businessesRouter.use('/:id/products', productsRouter);
businessesRouter.use('/:id/subscriptions', subscriptionsRouter);
businessesRouter.use('/:id/hours', businessHoursRouter);
businessesRouter.use('/:id/closures', businessClosuresRouter);

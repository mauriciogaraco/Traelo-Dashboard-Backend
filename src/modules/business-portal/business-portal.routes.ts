import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { Role } from '../../generated/prisma/enums';
import * as portalController from './business-portal.controller';
import {
  portalCustomersQuerySchema,
  portalOrdersQuerySchema,
  portalSummaryQuerySchema,
} from './business-portal.dto';

// Portal del dueño de negocio: solo BUSINESS_OWNER, y siempre sobre su propio negocio.
export const businessPortalRouter = Router();

businessPortalRouter.use(authenticate, authorize(Role.BUSINESS_OWNER));

businessPortalRouter.get('/', portalController.getMyBusiness);

businessPortalRouter.get(
  '/summary',
  validate({ query: portalSummaryQuerySchema }),
  portalController.getSummary,
);

businessPortalRouter.get(
  '/orders',
  validate({ query: portalOrdersQuerySchema }),
  portalController.listOrders,
);

businessPortalRouter.get(
  '/customers',
  validate({ query: portalCustomersQuerySchema }),
  portalController.getRecurringCustomers,
);

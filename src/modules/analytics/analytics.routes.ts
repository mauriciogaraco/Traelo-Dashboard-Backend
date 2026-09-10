import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { Role } from '../../generated/prisma/enums';
import * as analyticsController from './analytics.controller';
import {
  analyticsQuerySchema,
  productsByHourQuerySchema,
  customerTrendQuerySchema,
  ordersTrendQuerySchema,
  retentionCohortsQuerySchema,
} from './analytics.dto';

export const analyticsRouter = Router();

analyticsRouter.use(authenticate, authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE));

analyticsRouter.get(
  '/customers',
  validate({ query: analyticsQuerySchema }),
  analyticsController.getCustomerSegmentation,
);

analyticsRouter.get(
  '/demand-by-hour',
  validate({ query: analyticsQuerySchema }),
  analyticsController.getDemandByHour,
);

analyticsRouter.get(
  '/products-by-hour',
  validate({ query: productsByHourQuerySchema }),
  analyticsController.getProductsByHour,
);

analyticsRouter.get(
  '/customer-trend',
  validate({ query: customerTrendQuerySchema }),
  analyticsController.getCustomerTrend,
);

analyticsRouter.get(
  '/orders-trend',
  validate({ query: ordersTrendQuerySchema }),
  analyticsController.getOrdersTrend,
);

analyticsRouter.get(
  '/retention-cohorts',
  validate({ query: retentionCohortsQuerySchema }),
  analyticsController.getRetentionCohorts,
);

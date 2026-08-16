import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { Role } from '../../generated/prisma/enums';
import * as reportsController from './reports.controller';
import { reportsQuerySchema, topReportsQuerySchema } from './reports.dto';

export const reportsRouter = Router();

reportsRouter.use(authenticate, authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE));

reportsRouter.get(
  '/sales',
  validate({ query: reportsQuerySchema }),
  reportsController.getSalesReport,
);

reportsRouter.get(
  '/top-businesses',
  validate({ query: topReportsQuerySchema }),
  reportsController.getTopBusinesses,
);

reportsRouter.get(
  '/top-deliverers',
  validate({ query: topReportsQuerySchema }),
  reportsController.getTopDeliverers,
);

import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { idParamSchema } from '../../shared/http';
import { Role } from '../../generated/prisma/enums';
import * as reportsController from './reports.controller';
import { listReportsQuerySchema, reportsQuerySchema, topReportsQuerySchema } from './reports.dto';

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

reportsRouter.get(
  '/businesses',
  validate({ query: listReportsQuerySchema }),
  reportsController.getAllBusinesses,
);

reportsRouter.get(
  '/businesses/:id',
  validate({ params: idParamSchema, query: reportsQuerySchema }),
  reportsController.getBusinessSalesDetail,
);

reportsRouter.get(
  '/deliverers',
  validate({ query: listReportsQuerySchema }),
  reportsController.getAllDeliverers,
);

reportsRouter.get(
  '/deliverers/:id',
  validate({ params: idParamSchema, query: reportsQuerySchema }),
  reportsController.getDelivererSalesDetail,
);

import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { Role } from '../../generated/prisma/enums';
import * as dashboardController from './dashboard.controller';
import { reportsQuerySchema } from '../reports/reports.dto';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/summary',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ query: reportsQuerySchema }),
  dashboardController.getSummary,
);

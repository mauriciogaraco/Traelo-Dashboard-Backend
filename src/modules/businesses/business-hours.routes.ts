import { Router } from 'express';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { Role } from '../../generated/prisma/enums';
import { businessIdParamSchema } from './businesses.dto';
import * as businessHoursController from './business-hours.controller';
import { businessHoursParamsSchema, upsertBusinessHoursSchema } from './business-hours.dto';

export const businessHoursRouter = Router({ mergeParams: true });

businessHoursRouter.use(validate({ params: businessIdParamSchema }));

businessHoursRouter.get(
  '/',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  businessHoursController.listBusinessHours,
);

businessHoursRouter.put(
  '/:dayOfWeek',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: businessHoursParamsSchema, body: upsertBusinessHoursSchema }),
  businessHoursController.upsertBusinessHours,
);

businessHoursRouter.delete(
  '/:dayOfWeek',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: businessHoursParamsSchema }),
  businessHoursController.deleteBusinessHours,
);

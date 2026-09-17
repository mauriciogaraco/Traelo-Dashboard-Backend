import { Router } from 'express';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { Role } from '../../generated/prisma/enums';
import { businessIdParamSchema } from './businesses.dto';
import * as closuresController from './business-closures.controller';
import {
  closureParamsSchema,
  createClosureSchema,
  listClosuresQuerySchema,
} from './business-closures.dto';

export const businessClosuresRouter = Router({ mergeParams: true });

businessClosuresRouter.use(validate({ params: businessIdParamSchema }));

businessClosuresRouter.get(
  '/',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ query: listClosuresQuerySchema }),
  closuresController.listClosures,
);

businessClosuresRouter.post(
  '/',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ body: createClosureSchema }),
  closuresController.createClosure,
);

businessClosuresRouter.delete(
  '/:closureId',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: closureParamsSchema }),
  closuresController.deleteClosure,
);

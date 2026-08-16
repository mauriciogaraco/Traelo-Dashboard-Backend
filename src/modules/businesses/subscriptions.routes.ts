import { Router } from 'express';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { paginationQuerySchema } from '../../shared/http';
import { Role } from '../../generated/prisma/enums';
import { businessIdParamSchema } from './businesses.dto';
import * as subscriptionsController from './subscriptions.controller';
import {
  createSubscriptionSchema,
  subscriptionParamsSchema,
  updateSubscriptionSchema,
} from './subscriptions.dto';

export const subscriptionsRouter = Router({ mergeParams: true });

subscriptionsRouter.use(validate({ params: businessIdParamSchema }));
subscriptionsRouter.use(authorize(Role.OWNER, Role.ADMIN));

subscriptionsRouter.get(
  '/',
  validate({ query: paginationQuerySchema }),
  subscriptionsController.listSubscriptions,
);

subscriptionsRouter.post(
  '/',
  validate({ body: createSubscriptionSchema }),
  subscriptionsController.createSubscription,
);

subscriptionsRouter.get(
  '/:subId',
  validate({ params: subscriptionParamsSchema }),
  subscriptionsController.getSubscription,
);

subscriptionsRouter.patch(
  '/:subId',
  validate({ params: subscriptionParamsSchema, body: updateSubscriptionSchema }),
  subscriptionsController.updateSubscription,
);

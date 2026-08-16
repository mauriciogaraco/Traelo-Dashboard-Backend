import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import { Role } from '../generated/prisma/enums';
import * as systemConfigController from './system-config.controller';
import { updateSystemConfigSchema } from './system-config.dto';

export const systemConfigRouter = Router();

systemConfigRouter.use(authenticate);

systemConfigRouter.get('/', authorize(Role.OWNER, Role.ADMIN), systemConfigController.getConfig);

systemConfigRouter.patch(
  '/',
  authorize(Role.OWNER),
  validate({ body: updateSystemConfigSchema }),
  systemConfigController.updateConfig,
);

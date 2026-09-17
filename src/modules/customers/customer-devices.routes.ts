import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { customerIdParamSchema } from './customers.dto';
import * as devicesController from './customer-devices.controller';
import {
  deviceParamsSchema,
  registerDeviceSchema,
  updateDeviceSchema,
} from './customer-devices.dto';

export const customerDevicesRouter = Router({ mergeParams: true });

customerDevicesRouter.use(validate({ params: customerIdParamSchema }));

customerDevicesRouter.post(
  '/',
  validate({ body: registerDeviceSchema }),
  devicesController.registerDevice,
);

customerDevicesRouter.patch(
  '/:deviceId',
  validate({ params: deviceParamsSchema, body: updateDeviceSchema }),
  devicesController.updateDevice,
);

customerDevicesRouter.delete(
  '/:deviceId',
  validate({ params: deviceParamsSchema }),
  devicesController.deleteDevice,
);

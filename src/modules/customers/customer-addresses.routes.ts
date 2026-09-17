import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { customerIdParamSchema } from './customers.dto';
import * as addressesController from './customer-addresses.controller';
import {
  addressParamsSchema,
  createAddressSchema,
  updateAddressSchema,
} from './customer-addresses.dto';

export const customerAddressesRouter = Router({ mergeParams: true });

customerAddressesRouter.use(validate({ params: customerIdParamSchema }));

customerAddressesRouter.get('/', addressesController.listAddresses);

customerAddressesRouter.post(
  '/',
  validate({ body: createAddressSchema }),
  addressesController.createAddress,
);

customerAddressesRouter.patch(
  '/:addressId',
  validate({ params: addressParamsSchema, body: updateAddressSchema }),
  addressesController.updateAddress,
);

customerAddressesRouter.delete(
  '/:addressId',
  validate({ params: addressParamsSchema }),
  addressesController.deleteAddress,
);

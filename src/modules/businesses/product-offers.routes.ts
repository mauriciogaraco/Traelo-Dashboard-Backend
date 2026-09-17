import { Router } from 'express';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { Role } from '../../generated/prisma/enums';
import { productParamsSchema } from './products.dto';
import * as offersController from './product-offers.controller';
import { createOfferSchema, offerParamsSchema, updateOfferSchema } from './product-offers.dto';

export const productOffersRouter = Router({ mergeParams: true });

productOffersRouter.use(validate({ params: productParamsSchema }));

productOffersRouter.get(
  '/',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  offersController.listOffers,
);

productOffersRouter.post(
  '/',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ body: createOfferSchema }),
  offersController.createOffer,
);

productOffersRouter.patch(
  '/:offerId',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: offerParamsSchema, body: updateOfferSchema }),
  offersController.updateOffer,
);

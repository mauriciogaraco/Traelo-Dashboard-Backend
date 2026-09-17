import { Router } from 'express';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { imageUpload } from '../../middlewares/imageUpload';
import { Role } from '../../generated/prisma/enums';
import { businessIdParamSchema } from './businesses.dto';
import * as productsController from './products.controller';
import {
  createProductSchema,
  listProductsQuerySchema,
  productParamsSchema,
  setProductAvailabilitySchema,
  setProductCommissionSchema,
  updateProductSchema,
} from './products.dto';
import { productOffersRouter } from './product-offers.routes';

export const productsRouter = Router({ mergeParams: true });

productsRouter.use(validate({ params: businessIdParamSchema }));

productsRouter.get(
  '/',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ query: listProductsQuerySchema }),
  productsController.listProducts,
);

productsRouter.post(
  '/',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ body: createProductSchema }),
  productsController.createProduct,
);

productsRouter.get(
  '/:productId',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ params: productParamsSchema }),
  productsController.getProduct,
);

productsRouter.patch(
  '/:productId',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: productParamsSchema, body: updateProductSchema }),
  productsController.updateProduct,
);

productsRouter.delete(
  '/:productId',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: productParamsSchema }),
  productsController.deactivateProduct,
);

productsRouter.patch(
  '/:productId/availability',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ params: productParamsSchema, body: setProductAvailabilitySchema }),
  productsController.setAvailability,
);

productsRouter.post(
  '/:productId/image',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ params: productParamsSchema }),
  imageUpload.single('image'),
  productsController.setImage,
);

productsRouter.put(
  '/:productId/commission',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: productParamsSchema, body: setProductCommissionSchema }),
  productsController.setCommission,
);

productsRouter.delete(
  '/:productId/commission',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: productParamsSchema }),
  productsController.removeCommission,
);

productsRouter.use('/:productId/offers', productOffersRouter);

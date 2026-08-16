import { Router } from 'express';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { Role } from '../../generated/prisma/enums';
import { businessIdParamSchema } from './businesses.dto';
import * as productsController from './products.controller';
import {
  createProductSchema,
  listProductsQuerySchema,
  productParamsSchema,
  setProductCommissionSchema,
  updateProductSchema,
} from './products.dto';

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

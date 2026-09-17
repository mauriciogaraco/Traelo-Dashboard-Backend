import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { customerIdParamSchema } from './customers.dto';
import * as favoritesController from './customer-favorites.controller';
import {
  favoriteBusinessParamsSchema,
  favoriteProductParamsSchema,
} from './customer-favorites.dto';

export const customerFavoritesRouter = Router({ mergeParams: true });

customerFavoritesRouter.use(validate({ params: customerIdParamSchema }));

customerFavoritesRouter.get('/businesses', favoritesController.listFavoriteBusinesses);

customerFavoritesRouter.post(
  '/businesses/:businessId',
  validate({ params: favoriteBusinessParamsSchema }),
  favoritesController.addFavoriteBusiness,
);

customerFavoritesRouter.delete(
  '/businesses/:businessId',
  validate({ params: favoriteBusinessParamsSchema }),
  favoritesController.removeFavoriteBusiness,
);

customerFavoritesRouter.get('/products', favoritesController.listFavoriteProducts);

customerFavoritesRouter.post(
  '/products/:productId',
  validate({ params: favoriteProductParamsSchema }),
  favoritesController.addFavoriteProduct,
);

customerFavoritesRouter.delete(
  '/products/:productId',
  validate({ params: favoriteProductParamsSchema }),
  favoritesController.removeFavoriteProduct,
);

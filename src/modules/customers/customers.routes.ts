import { Router } from 'express';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth';
import {
  assertOwnCustomerId,
  authenticateCustomer,
  resolveMeAlias,
} from '../../middlewares/authenticateCustomer';
import { publicRateLimit } from '../../middlewares/publicRateLimit';
import { validate } from '../../middlewares/validate';
import * as customersController from './customers.controller';
import { customerIdParamSchema, updateCustomerSchema } from './customers.dto';
import { customerAddressesRouter } from './customer-addresses.routes';
import { customerDevicesRouter } from './customer-devices.routes';
import { customerFavoritesRouter } from './customer-favorites.routes';
import { customerOrdersRouter } from './customer-orders.routes';
import { customerReviewsRouter } from '../reviews/reviews.routes';

// Todo lo de /customers exige un cliente autenticado (Bearer de customer-auth): la identidad
// sale del token, no de la URL. "/customers/me/..." es el alias canónico; con un id explícito
// debe coincidir con el del token (si no, 403) — así un id ajeno nunca da acceso (IDOR).
// Crear clientes ya NO es posible desde acá (ver POST /auth/customer/register).
export const customersRouter = Router();

customersRouter.use(publicRateLimit, apiKeyAuth, authenticateCustomer, resolveMeAlias);
customersRouter.use('/:id', assertOwnCustomerId);

customersRouter.get(
  '/:id',
  validate({ params: customerIdParamSchema }),
  customersController.getCustomer,
);

customersRouter.patch(
  '/:id',
  validate({ params: customerIdParamSchema, body: updateCustomerSchema }),
  customersController.updateCustomer,
);

customersRouter.use('/:id/addresses', customerAddressesRouter);
customersRouter.use('/:id/devices', customerDevicesRouter);
customersRouter.use('/:id/favorites', customerFavoritesRouter);
customersRouter.use('/:id/orders', customerOrdersRouter);
customersRouter.use('/:id/reviews', customerReviewsRouter);

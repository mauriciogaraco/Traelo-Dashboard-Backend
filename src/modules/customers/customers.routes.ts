import { Router } from 'express';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth';
import { publicRateLimit } from '../../middlewares/publicRateLimit';
import { validate } from '../../middlewares/validate';
import * as customersController from './customers.controller';
import { createCustomerSchema, customerIdParamSchema, updateCustomerSchema } from './customers.dto';
import { customerAddressesRouter } from './customer-addresses.routes';
import { customerDevicesRouter } from './customer-devices.routes';
import { customerFavoritesRouter } from './customer-favorites.routes';
import { customerOrdersRouter } from './customer-orders.routes';

// Rutas públicas (sin JWT de staff): las usa la app móvil/web para que un cliente gestione
// su propio perfil. Sin OTP todavía, la app identifica al cliente por el id que guardó tras
// registrarse — ver la nota de auth en el checklist (misma decisión que catalog: API key +
// rate limit por ahora, autenticación real de Customer queda para otra tarea).
export const customersRouter = Router();

customersRouter.use(publicRateLimit, apiKeyAuth);

customersRouter.post(
  '/',
  validate({ body: createCustomerSchema }),
  customersController.createCustomer,
);

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

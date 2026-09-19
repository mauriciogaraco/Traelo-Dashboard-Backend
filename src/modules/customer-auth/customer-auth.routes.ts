import { Router } from 'express';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth';
import { validate } from '../../middlewares/validate';
import * as controller from './customer-auth.controller';
import {
  forgotPasswordCustomerSchema,
  loginCustomerSchema,
  refreshCustomerSchema,
  registerCustomerSchema,
  resetPasswordCustomerSchema,
} from './customer-auth.dto';
import { buildCustomerAuthLimiters, type CustomerAuthLimiters } from './customer-auth.rate-limit';

// /api/v1/auth/customer/* — autenticación de clientes de la app (Customer, NO User). Es
// OPCIONAL: ninguna de estas rutas es requisito para comprar. Van con la API key de la app
// y con límites propios de intentos (ver customer-auth.rate-limit.ts). Los limitadores se
// inyectan para poder probar los topes con valores chicos.
export function createCustomerAuthRouter(
  limiters: CustomerAuthLimiters = buildCustomerAuthLimiters(),
): Router {
  const router = Router();

  router.use(apiKeyAuth);

  router.post(
    '/register',
    limiters.register,
    validate({ body: registerCustomerSchema }),
    controller.register,
  );

  // validate va antes de los limitadores por teléfono: necesitan el teléfono ya normalizado
  // para que "+53 5 555 1234" y "+5355551234" cuenten contra el mismo cupo.
  router.post(
    '/login',
    validate({ body: loginCustomerSchema }),
    limiters.loginByIp,
    limiters.loginByPhone,
    controller.login,
  );

  router.post(
    '/refresh',
    limiters.refresh,
    validate({ body: refreshCustomerSchema }),
    controller.refresh,
  );

  router.post(
    '/logout',
    limiters.refresh,
    validate({ body: refreshCustomerSchema }),
    controller.logout,
  );

  router.post(
    '/forgot-password',
    validate({ body: forgotPasswordCustomerSchema }),
    limiters.recoveryByIp,
    limiters.recoveryByPhone,
    controller.forgotPassword,
  );

  router.post(
    '/reset-password',
    limiters.recoveryByIp,
    validate({ body: resetPasswordCustomerSchema }),
    controller.resetPassword,
  );

  return router;
}

export const customerAuthRouter = createCustomerAuthRouter();

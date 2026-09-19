import { Router } from 'express';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth';
import { optionalCustomerAuth } from '../../middlewares/authenticateCustomer';
import { publicRateLimit } from '../../middlewares/publicRateLimit';
import { validate } from '../../middlewares/validate';
import * as checkoutController from './checkout.controller';
import { checkoutOrderSchema } from './checkout.dto';

// Público (sin JWT de staff): API key + rate limit. Comprar NO exige cuenta: optionalCustomerAuth
// identifica al cliente si trae un Bearer válido y deja pasar como invitado si no trae ninguno
// (un Bearer inválido o vencido sí es 401, para que la app refresque en vez de perder el vínculo).
export const checkoutRouter = Router();

checkoutRouter.use(publicRateLimit, apiKeyAuth, optionalCustomerAuth);

checkoutRouter.post('/', validate({ body: checkoutOrderSchema }), checkoutController.createOrder);

import { Router } from 'express';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth';
import { publicRateLimit } from '../../middlewares/publicRateLimit';
import { validate } from '../../middlewares/validate';
import * as checkoutController from './checkout.controller';
import { checkoutOrderSchema } from './checkout.dto';

// Público (sin JWT de staff), mismo criterio que catalog/customers: API key + rate limit.
export const checkoutRouter = Router();

checkoutRouter.use(publicRateLimit, apiKeyAuth);

checkoutRouter.post('/', validate({ body: checkoutOrderSchema }), checkoutController.createOrder);

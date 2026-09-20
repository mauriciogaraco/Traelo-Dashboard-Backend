import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { idParamSchema } from '../../shared/http';
import { Role } from '../../generated/prisma/enums';
import * as deliverersController from './deliverers.controller';
import * as delivererLocationController from '../tracking/deliverer-location.controller';
import { updateDelivererLocationSchema } from '../tracking/deliverer-location.dto';
import {
  createDelivererSchema,
  listDeliverersQuerySchema,
  updateDelivererSchema,
} from './deliverers.dto';

export const deliverersRouter = Router();

deliverersRouter.use(authenticate);

deliverersRouter.get('/me', deliverersController.getMyProfile);

// Última ubicación del mensajero autenticado (la app de mensajero la envía mientras tiene una
// entrega activa). Solo DELIVERER, y sin :id en la URL: el mensajero sale siempre del token.
deliverersRouter.post(
  '/me/location',
  authorize(Role.DELIVERER),
  validate({ body: updateDelivererLocationSchema }),
  delivererLocationController.updateMyLocation,
);

// DELIVERER, exclusivo: "reiniciar historial" — deja de ver en su Historial los pedidos
// entregados/cancelados de antes de ahora. Sin body. Ver deliverersService.resetDelivererHistory.
deliverersRouter.patch(
  '/me/history-reset',
  authorize(Role.DELIVERER),
  deliverersController.resetMyHistory,
);

deliverersRouter.get(
  '/',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ query: listDeliverersQuerySchema }),
  deliverersController.listDeliverers,
);

deliverersRouter.post(
  '/',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ body: createDelivererSchema }),
  deliverersController.createDeliverer,
);

deliverersRouter.get(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ params: idParamSchema }),
  deliverersController.getDeliverer,
);

deliverersRouter.patch(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: idParamSchema, body: updateDelivererSchema }),
  deliverersController.updateDeliverer,
);

deliverersRouter.delete(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: idParamSchema }),
  deliverersController.deactivateDeliverer,
);

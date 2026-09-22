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
  updateDelivererDutySchema,
  updateDelivererPushTokenSchema,
  updateDelivererSchema,
} from './deliverers.dto';
import {
  catalogBusinessIdParamSchema,
  listCatalogBusinessesQuerySchema,
  listCatalogProductsQuerySchema,
} from '../catalog/catalog.dto';

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

// DELIVERER, exclusivo: registra/actualiza el token de Expo Push del dispositivo donde el
// mensajero tiene sesión — la app lo llama tras pedir permiso de notificaciones (nunca
// automático al abrir la app, mismo criterio contextual que la ubicación). Ver
// deliverersService.setDelivererPushToken y src/shared/push.
deliverersRouter.patch(
  '/me/push-token',
  authorize(Role.DELIVERER),
  validate({ body: updateDelivererPushTokenSchema }),
  deliverersController.updateMyPushToken,
);

// DELIVERER, exclusivo: activarse/desactivarse en la cola de despacho automático — mientras está
// activo, createOrder le asigna directo los pedidos nuevos en orden de turno (ver
// deliverersService.setDelivererDuty y ordersService.dispatchToQueue). No reemplaza la
// asignación manual del staff (PATCH /orders/:id/assign), que sigue funcionando igual.
deliverersRouter.patch(
  '/me/duty',
  authorize(Role.DELIVERER),
  validate({ body: updateDelivererDutySchema }),
  deliverersController.updateMyDuty,
);

// DELIVERER, exclusivo: buscar negocios/productos del catálogo para editar el vale (agregar
// productos, agregar un negocio nuevo al pedido — ver PATCH /orders/:id/items). Reutiliza el
// mismo catalogService que ya usa la app de clientes (search, solo productos `available`), pero
// autenticado por JWT en vez de API key — el mensajero ya tiene sesión, no tiene sentido
// pedirle una API key aparte. Declaradas ANTES de "/:id" para que "catalog" no se intente
// interpretar como un id de mensajero.
deliverersRouter.get(
  '/catalog/businesses',
  authorize(Role.DELIVERER),
  validate({ query: listCatalogBusinessesQuerySchema }),
  deliverersController.searchCatalogBusinesses,
);

deliverersRouter.get(
  '/catalog/businesses/:businessId/products',
  authorize(Role.DELIVERER),
  validate({ params: catalogBusinessIdParamSchema, query: listCatalogProductsQuerySchema }),
  deliverersController.searchCatalogProducts,
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

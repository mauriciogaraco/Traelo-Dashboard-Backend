import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { idParamSchema } from '../../shared/http';
import { Role } from '../../generated/prisma/enums';
import * as ordersController from './orders.controller';
import {
  assignOrderSchema,
  bulkCompleteOrdersSchema,
  createOrderSchema,
  listOrdersQuerySchema,
  updateOrderItemsSchema,
  updateOrderSchema,
  updateOrderStageSchema,
  updateOrderStatusSchema,
} from './orders.dto';

export const ordersRouter = Router();

ordersRouter.use(authenticate);

ordersRouter.get(
  '/',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ query: listOrdersQuerySchema }),
  ordersController.listOrders,
);

ordersRouter.patch(
  '/bulk/complete',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ body: bulkCompleteOrdersSchema }),
  ordersController.bulkCompleteOrders,
);

ordersRouter.post(
  '/',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ body: createOrderSchema }),
  ordersController.createOrder,
);

ordersRouter.get(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ params: idParamSchema }),
  ordersController.getOrder,
);

ordersRouter.patch(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ params: idParamSchema, body: updateOrderSchema }),
  ordersController.updateOrder,
);

ordersRouter.delete(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: idParamSchema }),
  ordersController.deleteOrder,
);

ordersRouter.patch(
  '/:id/assign',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ params: idParamSchema, body: assignOrderSchema }),
  ordersController.assignOrder,
);

// DELIVERER autenticado: solo puede cambiar el estado de sus propios pedidos (ownership check en
// ordersService, ver resolveDelivererScope) y con una tabla de transiciones más estricta
// (DELIVERER_STATUS_TRANSITIONS) que la de staff — tiene que aceptar antes de confirmar y avanzar
// las sub-fases del trayecto en orden, sin saltos.
ordersRouter.patch(
  '/:id/status',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ params: idParamSchema, body: updateOrderStatusSchema }),
  ordersController.updateOrderStatus,
);

// DELIVERER, exclusivo: "acepta" ("se autoasigna") un pedido recién llegado — marca `acceptedAt`
// sin cambiar `status` (sigue ASSIGNED, "Por confirmar"). Ver ordersService.acceptOrder.
ordersRouter.patch(
  '/:id/accept',
  authorize(Role.DELIVERER),
  validate({ params: idParamSchema }),
  ordersController.acceptOrder,
);

// DELIVERER, exclusivo: rechaza un pedido recién asignado y todavía no aceptado — vuelve a
// PENDING y se re-despacha en cascada al siguiente en la cola. Ver ordersService.declineOrder.
ordersRouter.patch(
  '/:id/decline',
  authorize(Role.DELIVERER),
  validate({ params: idParamSchema }),
  ordersController.declineOrder,
);

// DELIVERER, exclusivo: edita cantidad/precio/negocios de su propio vale (el precio real en el
// negocio puede no coincidir con el que traía el pedido al armarse). Reutiliza updateOrder con
// scopeDelivererId para el ownership check — nunca acepta datos del cliente ni mensajería/
// Servicio Tráelo, eso sigue siendo exclusivo de PATCH /:id (staff). Ver ordersService.updateOrder.
ordersRouter.patch(
  '/:id/items',
  authorize(Role.DELIVERER),
  validate({ params: idParamSchema, body: updateOrderItemsSchema }),
  ordersController.updateOrderItems,
);

// Etapa del reparto (recogiendo / en camino). El mensajero mueve SOLO sus pedidos; el staff, cualquiera.
// Legacy: la app móvil actual avanza el trayecto vía PATCH /:id/status (HEADING_OUT/PICKING_UP/
// ON_THE_WAY como estados), que también actualiza pickingUpAt/onTheWayAt — ver
// ordersService.updateOrderStatus. Se conserva por compatibilidad con clientes que sigan usándola.
ordersRouter.patch(
  '/:id/stage',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ params: idParamSchema, body: updateOrderStageSchema }),
  ordersController.updateOrderStage,
);

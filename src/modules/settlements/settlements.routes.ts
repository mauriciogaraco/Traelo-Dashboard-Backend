import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { idParamSchema } from '../../shared/http';
import { Role } from '../../generated/prisma/enums';
import * as settlementsController from './settlements.controller';
import { generateSettlementSchema, listSettlementsQuerySchema } from './settlements.dto';

export const settlementsRouter = Router();

settlementsRouter.use(authenticate);

settlementsRouter.get(
  '/',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ query: listSettlementsQuerySchema }),
  settlementsController.listSettlements,
);

// DELIVERER puede generar su propio cuadre diario (autoservicio, "al terminar el día") — ver
// resolveDelivererScope en el controller, que ignora cualquier delivererId que mande el cliente
// y usa siempre el propio. Staff conserva la generación para cualquier mensajero, sin cambios.
settlementsRouter.post(
  '/daily/generate',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ body: generateSettlementSchema }),
  settlementsController.generateDailySettlement,
);

settlementsRouter.post(
  '/weekly/generate',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ body: generateSettlementSchema }),
  settlementsController.generateWeeklySettlement,
);

settlementsRouter.get(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ params: idParamSchema }),
  settlementsController.getSettlement,
);

settlementsRouter.get(
  '/:id/orders',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.DELIVERER),
  validate({ params: idParamSchema }),
  settlementsController.getSettlementOrders,
);

settlementsRouter.post(
  '/:id/close',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: idParamSchema }),
  settlementsController.closeSettlement,
);

settlementsRouter.delete(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ params: idParamSchema }),
  settlementsController.deleteSettlement,
);

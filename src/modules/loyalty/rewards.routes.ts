import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { optionalCustomerAuth } from '../../middlewares/authenticateCustomer';
import { publicRateLimit } from '../../middlewares/publicRateLimit';
import { validate } from '../../middlewares/validate';
import { Role } from '../../generated/prisma/enums';
import { sendCreated, sendOk } from '../../shared/http';
import * as rewardsService from './rewards.service';

// GET /rewards — recompensas visibles para la app. Abierto a invitados (pueden ver qué se puede
// canjear); con un Bearer válido añade el saldo y, por recompensa, si alcanza y cuánto falta.
export const rewardsRouter = Router();

rewardsRouter.use(publicRateLimit, apiKeyAuth, optionalCustomerAuth);

rewardsRouter.get('/', async (req: Request, res: Response) => {
  sendOk(res, await rewardsService.listRewards(req.customer?.id));
});

// Administración (dashboard): crear, editar y activar/desactivar recompensas. Solo OWNER/ADMIN.
const rewardBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(300).nullable().optional(),
  pointsCost: z.number().int().min(1).max(1_000_000),
  productId: z.cuid('id de producto inválido'),
  imageUrl: z.url().nullable().optional(),
  active: z.boolean().optional(),
});
const updateRewardBodySchema = rewardBodySchema.partial();
const rewardIdParamSchema = z.object({ id: z.cuid('id de recompensa inválido') });

export const rewardsAdminRouter = Router();

rewardsAdminRouter.use(authenticate, authorize(Role.OWNER, Role.ADMIN));

rewardsAdminRouter.get('/', async (_req: Request, res: Response) => {
  sendOk(res, await rewardsService.adminListRewards());
});

rewardsAdminRouter.post('/', validate({ body: rewardBodySchema }), async (req: Request, res: Response) => {
  sendCreated(res, await rewardsService.createReward(req.body as z.infer<typeof rewardBodySchema>));
});

rewardsAdminRouter.patch(
  '/:id',
  validate({ params: rewardIdParamSchema, body: updateRewardBodySchema }),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    sendOk(res, await rewardsService.updateReward(id, req.body as z.infer<typeof updateRewardBodySchema>));
  },
);

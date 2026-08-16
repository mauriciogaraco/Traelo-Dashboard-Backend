import type { Request, Response } from 'express';
import { sendCreated, sendOk, sendPaginated, type IdParam } from '../../shared/http';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors';
import { Role } from '../../generated/prisma/enums';
import * as deliverersService from './deliverers.service';
import type {
  CreateDelivererInput,
  ListDeliverersQuery,
  UpdateDelivererInput,
} from './deliverers.dto';

export async function listDeliverers(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListDeliverersQuery;
  const { data, meta } = await deliverersService.listDeliverers(query);
  sendPaginated(res, data, meta);
}

export async function createDeliverer(req: Request, res: Response): Promise<void> {
  const deliverer = await deliverersService.createDeliverer(req.body as CreateDelivererInput);
  sendCreated(res, deliverer);
}

export async function getMyProfile(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  const deliverer = await deliverersService.getDelivererByUserId(req.user.sub);
  sendOk(res, deliverer);
}

export async function getDeliverer(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const deliverer = await deliverersService.getDelivererById(id);

  if (req.user?.role === Role.DELIVERER && deliverer.userId !== req.user.sub) {
    throw new ForbiddenError();
  }

  sendOk(res, deliverer);
}

export async function updateDeliverer(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const deliverer = await deliverersService.updateDeliverer(id, req.body as UpdateDelivererInput);
  sendOk(res, deliverer);
}

export async function deactivateDeliverer(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const deliverer = await deliverersService.deactivateDeliverer(id);
  sendOk(res, deliverer);
}

import type { Request, Response } from 'express';
import { sendCreated, sendOk, sendPaginated, type IdParam } from '../../shared/http';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors';
import { Role } from '../../generated/prisma/enums';
import * as deliverersService from './deliverers.service';
import * as catalogService from '../catalog/catalog.service';
import type {
  CreateDelivererInput,
  ListDeliverersQuery,
  UpdateDelivererDutyInput,
  UpdateDelivererInput,
  UpdateDelivererPushTokenInput,
} from './deliverers.dto';
import type {
  CatalogBusinessIdParam,
  ListCatalogBusinessesQuery,
  ListCatalogProductsQuery,
} from '../catalog/catalog.dto';

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

// Ver el comentario en deliverers.routes.ts — mismo catalogService que usa la app de clientes,
// solo que autenticado por JWT (DELIVERER) en vez de API key.
export async function searchCatalogBusinesses(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListCatalogBusinessesQuery;
  const businesses = await catalogService.listCatalogBusinesses(query);
  sendOk(res, businesses);
}

export async function searchCatalogProducts(req: Request, res: Response): Promise<void> {
  const { businessId } = req.params as unknown as CatalogBusinessIdParam;
  const query = req.query as unknown as ListCatalogProductsQuery;
  const products = await catalogService.listCatalogProducts(businessId, query);
  sendOk(res, products);
}

export async function resetMyHistory(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  const me = await deliverersService.getDelivererByUserId(req.user.sub);
  const deliverer = await deliverersService.resetDelivererHistory(me.id);
  sendOk(res, deliverer);
}

export async function updateMyPushToken(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  const { expoPushToken } = req.body as UpdateDelivererPushTokenInput;
  const me = await deliverersService.getDelivererByUserId(req.user.sub);
  const deliverer = await deliverersService.setDelivererPushToken(me.id, expoPushToken);
  sendOk(res, deliverer);
}

export async function updateMyDuty(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  const { onDuty } = req.body as UpdateDelivererDutyInput;
  const me = await deliverersService.getDelivererByUserId(req.user.sub);
  const deliverer = await deliverersService.setDelivererDuty(me.id, onDuty);
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

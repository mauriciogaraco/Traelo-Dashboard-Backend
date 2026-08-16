import type { Request, Response } from 'express';
import { sendCreated, sendOk, sendPaginated, type IdParam } from '../../shared/http';
import { UnauthorizedError } from '../../shared/errors';
import { Role } from '../../generated/prisma/enums';
import * as settlementsService from './settlements.service';
import * as deliverersService from '../deliverers/deliverers.service';
import type { GenerateSettlementInput, ListSettlementsQuery } from './settlements.dto';

async function resolveDelivererScope(req: Request): Promise<string | undefined> {
  if (req.user?.role !== Role.DELIVERER) {
    return undefined;
  }
  const deliverer = await deliverersService.getDelivererByUserId(req.user.sub);
  return deliverer.id;
}

export async function listSettlements(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListSettlementsQuery;
  const scopeDelivererId = await resolveDelivererScope(req);
  const { data, meta } = await settlementsService.listSettlements(query, scopeDelivererId);
  sendPaginated(res, data, meta);
}

export async function generateDailySettlement(req: Request, res: Response): Promise<void> {
  const settlement = await settlementsService.generateDailySettlement(
    req.body as GenerateSettlementInput,
  );
  sendCreated(res, settlement);
}

export async function generateWeeklySettlement(req: Request, res: Response): Promise<void> {
  const settlement = await settlementsService.generateWeeklySettlement(
    req.body as GenerateSettlementInput,
  );
  sendCreated(res, settlement);
}

export async function getSettlement(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const scopeDelivererId = await resolveDelivererScope(req);
  const settlement = await settlementsService.getSettlementById(id, scopeDelivererId);
  sendOk(res, settlement);
}

export async function closeSettlement(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  const { id } = req.params as unknown as IdParam;
  const settlement = await settlementsService.closeSettlement(id, req.user.sub);
  sendOk(res, settlement);
}

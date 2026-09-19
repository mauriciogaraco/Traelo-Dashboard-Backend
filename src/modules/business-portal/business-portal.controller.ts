import type { Request, Response } from 'express';
import { sendOk, sendPaginated } from '../../shared/http';
import { UnauthorizedError } from '../../shared/errors';
import { resolveOwnerBusinessId } from '../../shared/business-scope';
import * as portalService from './business-portal.service';
import type {
  PortalCustomersQuery,
  PortalOrdersQuery,
  PortalSummaryQuery,
} from './business-portal.dto';

// El negocio se resuelve SIEMPRE desde la cuenta autenticada, nunca desde un parámetro.
async function ownBusinessId(req: Request): Promise<string> {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  return resolveOwnerBusinessId(req.user.sub);
}

export async function getMyBusiness(req: Request, res: Response): Promise<void> {
  sendOk(res, await portalService.getMyBusiness(await ownBusinessId(req)));
}

export async function getSummary(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as PortalSummaryQuery;
  sendOk(res, await portalService.getSummary(await ownBusinessId(req), query));
}

export async function listOrders(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as PortalOrdersQuery;
  const { data, meta } = await portalService.listOrders(await ownBusinessId(req), query);
  sendPaginated(res, data, meta);
}

export async function getRecurringCustomers(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as PortalCustomersQuery;
  sendOk(res, await portalService.getRecurringCustomers(await ownBusinessId(req), query));
}

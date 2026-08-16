import type { Request, Response } from 'express';
import { sendCreated, sendOk, sendPaginated } from '../../shared/http';
import * as businessesService from './businesses.service';
import type {
  BusinessIdParam,
  CreateBusinessInput,
  ListBusinessesQuery,
  UpdateBusinessInput,
} from './businesses.dto';

export async function listBusinesses(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListBusinessesQuery;
  const { data, meta } = await businessesService.listBusinesses(query);
  sendPaginated(res, data, meta);
}

export async function createBusiness(req: Request, res: Response): Promise<void> {
  const business = await businessesService.createBusiness(req.body as CreateBusinessInput);
  sendCreated(res, business);
}

export async function getBusiness(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as BusinessIdParam;
  const business = await businessesService.getBusinessById(id);
  sendOk(res, business);
}

export async function updateBusiness(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as BusinessIdParam;
  const business = await businessesService.updateBusiness(id, req.body as UpdateBusinessInput);
  sendOk(res, business);
}

export async function deactivateBusiness(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as BusinessIdParam;
  const business = await businessesService.deactivateBusiness(id);
  sendOk(res, business);
}

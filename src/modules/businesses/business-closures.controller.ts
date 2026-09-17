import type { Request, Response } from 'express';
import { sendCreated, sendNoContent, sendOk } from '../../shared/http';
import * as closuresService from './business-closures.service';
import type { ClosureParams, CreateClosureInput, ListClosuresQuery } from './business-closures.dto';

export async function listClosures(req: Request, res: Response): Promise<void> {
  const { id: businessId } = req.params as unknown as { id: string };
  const query = req.query as unknown as ListClosuresQuery;
  const closures = await closuresService.listClosures(businessId, query);
  sendOk(res, closures);
}

export async function createClosure(req: Request, res: Response): Promise<void> {
  const { id: businessId } = req.params as unknown as { id: string };
  const closure = await closuresService.createClosure(businessId, req.body as CreateClosureInput);
  sendCreated(res, closure);
}

export async function deleteClosure(req: Request, res: Response): Promise<void> {
  const { id: businessId, closureId } = req.params as unknown as ClosureParams;
  await closuresService.deleteClosure(businessId, closureId);
  sendNoContent(res);
}

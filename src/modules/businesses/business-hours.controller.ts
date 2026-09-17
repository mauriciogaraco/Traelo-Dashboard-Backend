import type { Request, Response } from 'express';
import { sendNoContent, sendOk } from '../../shared/http';
import * as businessHoursService from './business-hours.service';
import type { BusinessHoursParams, UpsertBusinessHoursInput } from './business-hours.dto';

export async function listBusinessHours(req: Request, res: Response): Promise<void> {
  const { id: businessId } = req.params as unknown as { id: string };
  const hours = await businessHoursService.listBusinessHours(businessId);
  sendOk(res, hours);
}

export async function upsertBusinessHours(req: Request, res: Response): Promise<void> {
  const { id: businessId, dayOfWeek } = req.params as unknown as BusinessHoursParams;
  const hours = await businessHoursService.upsertBusinessHours(
    businessId,
    dayOfWeek,
    req.body as UpsertBusinessHoursInput,
  );
  sendOk(res, hours);
}

export async function deleteBusinessHours(req: Request, res: Response): Promise<void> {
  const { id: businessId, dayOfWeek } = req.params as unknown as BusinessHoursParams;
  await businessHoursService.deleteBusinessHours(businessId, dayOfWeek);
  sendNoContent(res);
}

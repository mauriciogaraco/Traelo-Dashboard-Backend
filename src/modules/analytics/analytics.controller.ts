import type { Request, Response } from 'express';
import { sendOk } from '../../shared/http';
import * as analyticsService from './analytics.service';
import type { AnalyticsQuery, ProductsByHourQuery } from './analytics.dto';

export async function getCustomerSegmentation(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as AnalyticsQuery;
  const data = await analyticsService.getCustomerSegmentation(query);
  sendOk(res, data);
}

export async function getDemandByHour(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as AnalyticsQuery;
  const data = await analyticsService.getDemandByHour(query);
  sendOk(res, data);
}

export async function getProductsByHour(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ProductsByHourQuery;
  const data = await analyticsService.getProductsByHour(query);
  sendOk(res, data);
}

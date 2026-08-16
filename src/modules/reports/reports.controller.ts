import type { Request, Response } from 'express';
import { sendOk } from '../../shared/http';
import * as reportsService from './reports.service';
import type { ReportsQuery, TopReportsQuery } from './reports.dto';

export async function getSalesReport(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ReportsQuery;
  const report = await reportsService.getSalesReport(query);
  sendOk(res, report);
}

export async function getTopBusinesses(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as TopReportsQuery;
  const report = await reportsService.getTopBusinesses(query);
  sendOk(res, report);
}

export async function getTopDeliverers(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as TopReportsQuery;
  const report = await reportsService.getTopDeliverers(query);
  sendOk(res, report);
}

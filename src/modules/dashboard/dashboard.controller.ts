import type { Request, Response } from 'express';
import { sendOk } from '../../shared/http';
import * as dashboardService from './dashboard.service';
import type { ReportsQuery } from '../reports/reports.dto';

export async function getSummary(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ReportsQuery;
  const summary = await dashboardService.getDashboardSummary(query);
  sendOk(res, summary);
}

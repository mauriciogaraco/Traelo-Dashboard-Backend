import type { Request, Response } from 'express';
import { sendOk, sendPaginated, type IdParam } from '../../shared/http';
import * as reportsService from './reports.service';
import type { ListReportsQuery, ReportsQuery, TopReportsQuery } from './reports.dto';

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

export async function getAllBusinesses(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListReportsQuery;
  const { data, meta } = await reportsService.getAllBusinesses(query);
  sendPaginated(res, data, meta);
}

export async function getBusinessSalesDetail(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const query = req.query as unknown as ReportsQuery;
  const detail = await reportsService.getBusinessSalesDetail(id, query);
  sendOk(res, detail);
}

export async function getAllDeliverers(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListReportsQuery;
  const { data, meta } = await reportsService.getAllDeliverers(query);
  sendPaginated(res, data, meta);
}

export async function getDelivererSalesDetail(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const query = req.query as unknown as ReportsQuery;
  const detail = await reportsService.getDelivererSalesDetail(id, query);
  sendOk(res, detail);
}

export async function getBusinessBreakdownByDeliverer(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const query = req.query as unknown as ReportsQuery;
  const breakdown = await reportsService.getBusinessBreakdownByDeliverer(id, query);
  sendOk(res, breakdown);
}

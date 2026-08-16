import type { Response } from 'express';

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function sendOk<T>(res: Response, data: T, statusCode = 200): Response {
  return res.status(statusCode).json({ data });
}

export function sendPaginated<T>(
  res: Response,
  data: T[],
  meta: PaginationMeta,
  statusCode = 200,
): Response {
  return res.status(statusCode).json({ data, meta });
}

export function sendCreated<T>(res: Response, data: T): Response {
  return sendOk(res, data, 201);
}

export function sendNoContent(res: Response): Response {
  return res.status(204).send();
}

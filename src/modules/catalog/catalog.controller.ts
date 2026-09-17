import type { Request, Response } from 'express';
import { sendOk } from '../../shared/http';
import * as catalogService from './catalog.service';
import type {
  CatalogBusinessIdParam,
  ListCatalogBusinessesQuery,
  ListCatalogChangesQuery,
  ListCatalogProductsQuery,
} from './catalog.dto';

export async function getBootstrap(_req: Request, res: Response): Promise<void> {
  const bootstrap = await catalogService.getCatalogBootstrap();
  sendOk(res, bootstrap);
}

export async function getVersion(_req: Request, res: Response): Promise<void> {
  const version = await catalogService.getCatalogVersion();
  sendOk(res, version);
}

export async function getChanges(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListCatalogChangesQuery;
  const { data, latestVersion } = await catalogService.getCatalogChanges(query);
  sendOk(res, { changes: data, latestVersion });
}

export async function listCategories(_req: Request, res: Response): Promise<void> {
  const categories = await catalogService.listCatalogCategories();
  sendOk(res, categories);
}

export async function listBusinesses(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListCatalogBusinessesQuery;
  const businesses = await catalogService.listCatalogBusinesses(query);
  sendOk(res, businesses);
}

export async function listProducts(req: Request, res: Response): Promise<void> {
  const { businessId } = req.params as unknown as CatalogBusinessIdParam;
  const query = req.query as unknown as ListCatalogProductsQuery;
  const products = await catalogService.listCatalogProducts(businessId, query);
  sendOk(res, products);
}

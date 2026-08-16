import type { Request, Response } from 'express';
import { sendCreated, sendNoContent, sendOk, sendPaginated } from '../../shared/http';
import * as productsService from './products.service';
import type {
  CreateProductInput,
  ListProductsQuery,
  ProductParams,
  SetProductCommissionInput,
  UpdateProductInput,
} from './products.dto';

export async function listProducts(req: Request, res: Response): Promise<void> {
  const { id: businessId } = req.params as unknown as { id: string };
  const query = req.query as unknown as ListProductsQuery;
  const { data, meta } = await productsService.listProducts(businessId, query);
  sendPaginated(res, data, meta);
}

export async function createProduct(req: Request, res: Response): Promise<void> {
  const { id: businessId } = req.params as unknown as { id: string };
  const product = await productsService.createProduct(businessId, req.body as CreateProductInput);
  sendCreated(res, product);
}

export async function getProduct(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId } = req.params as unknown as ProductParams;
  const product = await productsService.getProduct(businessId, productId);
  sendOk(res, product);
}

export async function updateProduct(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId } = req.params as unknown as ProductParams;
  const product = await productsService.updateProduct(
    businessId,
    productId,
    req.body as UpdateProductInput,
  );
  sendOk(res, product);
}

export async function deactivateProduct(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId } = req.params as unknown as ProductParams;
  const product = await productsService.deactivateProduct(businessId, productId);
  sendOk(res, product);
}

export async function setCommission(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId } = req.params as unknown as ProductParams;
  const commission = await productsService.setProductCommission(
    businessId,
    productId,
    req.body as SetProductCommissionInput,
  );
  sendOk(res, commission);
}

export async function removeCommission(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId } = req.params as unknown as ProductParams;
  await productsService.removeProductCommission(businessId, productId);
  sendNoContent(res);
}

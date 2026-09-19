import type { Request, Response } from 'express';
import { sendCreated, sendNoContent, sendOk, sendPaginated } from '../../shared/http';
import { BadRequestError } from '../../shared/errors';
import { Role } from '../../generated/prisma/enums';
import { toOwnerProductDTO } from './owner-view';
import * as productsService from './products.service';
import type { ProductDTO } from './products.service';
import type {
  CreateProductInput,
  ListProductsQuery,
  ProductParams,
  SetProductAvailabilityInput,
  SetProductCommissionInput,
  UpdateProductInput,
} from './products.dto';

// La comisión por producto es ganancia de Tráelo: un dueño de negocio nunca la recibe.
function forViewer(req: Request, product: ProductDTO): ProductDTO {
  return req.user?.role === Role.BUSINESS_OWNER ? toOwnerProductDTO(product) : product;
}

export async function listProducts(req: Request, res: Response): Promise<void> {
  const { id: businessId } = req.params as unknown as { id: string };
  const query = req.query as unknown as ListProductsQuery;
  const { data, meta } = await productsService.listProducts(businessId, query);
  sendPaginated(
    res,
    data.map((product) => forViewer(req, product)),
    meta,
  );
}

export async function createProduct(req: Request, res: Response): Promise<void> {
  const { id: businessId } = req.params as unknown as { id: string };
  const product = await productsService.createProduct(businessId, req.body as CreateProductInput);
  sendCreated(res, forViewer(req, product));
}

export async function getProduct(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId } = req.params as unknown as ProductParams;
  const product = await productsService.getProduct(businessId, productId);
  sendOk(res, forViewer(req, product));
}

export async function updateProduct(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId } = req.params as unknown as ProductParams;
  const product = await productsService.updateProduct(
    businessId,
    productId,
    req.body as UpdateProductInput,
  );
  sendOk(res, forViewer(req, product));
}

export async function deactivateProduct(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId } = req.params as unknown as ProductParams;
  const product = await productsService.deactivateProduct(businessId, productId);
  sendOk(res, forViewer(req, product));
}

export async function setAvailability(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId } = req.params as unknown as ProductParams;
  const product = await productsService.setProductAvailability(
    businessId,
    productId,
    req.body as SetProductAvailabilityInput,
  );
  sendOk(res, forViewer(req, product));
}

export async function setImage(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId } = req.params as unknown as ProductParams;
  if (!req.file) {
    throw new BadRequestError('Falta el archivo de imagen (campo "image")', 'MISSING_FILE');
  }
  const product = await productsService.setProductImage(businessId, productId, req.file.buffer);
  sendOk(res, forViewer(req, product));
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

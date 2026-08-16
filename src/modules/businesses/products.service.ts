import { NotFoundError, BadRequestError } from '../../shared/errors';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import { decimalToNumber } from '../../shared/prisma';
import type { Prisma } from '../../generated/prisma/client';
import * as businessesRepository from './businesses.repository';
import * as productsRepository from './products.repository';
import type {
  CreateProductInput,
  ListProductsQuery,
  SetProductCommissionInput,
  UpdateProductInput,
} from './products.dto';

export interface ProductCommissionDTO {
  commissionAmount: number;
}

export interface ProductDTO {
  id: string;
  businessId: string;
  name: string;
  category: string | null;
  price: number | null;
  active: boolean;
  externalId: string | null;
  commission: ProductCommissionDTO | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductRecord {
  id: string;
  businessId: string;
  name: string;
  category: string | null;
  price: Prisma.Decimal | null;
  active: boolean;
  externalId: string | null;
  commission: { commissionAmount: Prisma.Decimal } | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(product: ProductRecord): ProductDTO {
  return {
    id: product.id,
    businessId: product.businessId,
    name: product.name,
    category: product.category,
    price: decimalToNumber(product.price),
    active: product.active,
    externalId: product.externalId,
    commission: product.commission
      ? { commissionAmount: decimalToNumber(product.commission.commissionAmount) }
      : null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

async function assertBusinessExists(businessId: string): Promise<void> {
  const business = await businessesRepository.findById(businessId);
  if (!business) {
    throw new NotFoundError('Negocio no encontrado');
  }
}

async function assertProductExists(businessId: string, productId: string): Promise<ProductRecord> {
  const product = await productsRepository.findByIdForBusiness(productId, businessId);
  if (!product) {
    throw new NotFoundError('Producto no encontrado');
  }
  return product;
}

export async function createProduct(
  businessId: string,
  input: CreateProductInput,
): Promise<ProductDTO> {
  await assertBusinessExists(businessId);

  const product = await productsRepository.create({
    businessId,
    name: input.name,
    category: input.category,
    price: input.price,
    externalId: input.externalId,
  });

  return toDTO(product);
}

export async function listProducts(
  businessId: string,
  query: ListProductsQuery,
): Promise<{ data: ProductDTO[]; meta: PaginationMeta }> {
  await assertBusinessExists(businessId);

  const where: Prisma.ProductWhereInput = {
    businessId,
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.category ? { category: query.category } : {}),
  };

  const { skip, take } = toSkipTake(query);
  const [products, total] = await Promise.all([
    productsRepository.findMany(where, skip, take),
    productsRepository.count(where),
  ]);

  return { data: products.map(toDTO), meta: buildPaginationMeta(query, total) };
}

export async function getProduct(businessId: string, productId: string): Promise<ProductDTO> {
  const product = await assertProductExists(businessId, productId);
  return toDTO(product);
}

export async function updateProduct(
  businessId: string,
  productId: string,
  input: UpdateProductInput,
): Promise<ProductDTO> {
  await assertProductExists(businessId, productId);
  const product = await productsRepository.update(productId, input);
  return toDTO(product);
}

export async function deactivateProduct(
  businessId: string,
  productId: string,
): Promise<ProductDTO> {
  await assertProductExists(businessId, productId);
  const product = await productsRepository.update(productId, { active: false });
  return toDTO(product);
}

export async function setProductCommission(
  businessId: string,
  productId: string,
  input: SetProductCommissionInput,
): Promise<ProductCommissionDTO> {
  const business = await businessesRepository.findById(businessId);
  if (!business) {
    throw new NotFoundError('Negocio no encontrado');
  }
  if (business.commissionType !== 'FIXED_PER_PRODUCT') {
    throw new BadRequestError(
      'Solo se puede asignar comisión por producto cuando el negocio usa el modelo FIXED_PER_PRODUCT',
    );
  }

  await assertProductExists(businessId, productId);

  const commission = await productsRepository.upsertCommission(
    businessId,
    productId,
    input.commissionAmount,
  );

  return { commissionAmount: decimalToNumber(commission.commissionAmount) };
}

export async function removeProductCommission(
  businessId: string,
  productId: string,
): Promise<void> {
  await assertProductExists(businessId, productId);
  await productsRepository.deleteCommission(productId);
}

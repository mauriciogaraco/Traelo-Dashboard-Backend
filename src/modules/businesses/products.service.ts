import { NotFoundError, BadRequestError } from '../../shared/errors';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import { decimalToNumber } from '../../shared/prisma';
import { bumpCatalogVersion } from '../../shared/catalog';
import { uploadImage } from '../../shared/cloudinary';
import { CatalogEntityType, CatalogChangeType } from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';
import * as businessesRepository from './businesses.repository';
import * as productsRepository from './products.repository';
import * as categoriesService from '../categories/categories.service';
import { packagingToDb, parsePackaging, type PackagingOption } from './packaging';
import type {
  CreateProductInput,
  ListProductsQuery,
  SetProductAvailabilityInput,
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
  description: string | null;
  category: string | null;
  categoryId: string | null;
  price: number | null;
  active: boolean;
  available: boolean;
  lowStock: boolean;
  externalId: string | null;
  imageUrl: string | null;
  packaging: PackagingOption[] | null;
  commission: ProductCommissionDTO | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductRecord {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  category: string | null;
  categoryId: string | null;
  price: Prisma.Decimal | null;
  active: boolean;
  available: boolean;
  lowStock: boolean;
  externalId: string | null;
  imageUrl: string | null;
  packaging: Prisma.JsonValue | null;
  commission: { commissionAmount: Prisma.Decimal } | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(product: ProductRecord): ProductDTO {
  return {
    id: product.id,
    businessId: product.businessId,
    name: product.name,
    description: product.description,
    category: product.category,
    categoryId: product.categoryId,
    price: decimalToNumber(product.price),
    active: product.active,
    available: product.available,
    lowStock: product.lowStock,
    externalId: product.externalId,
    imageUrl: product.imageUrl,
    packaging: parsePackaging(product.packaging),
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
  if (input.categoryId) {
    await categoriesService.assertCategoryExists(input.categoryId);
  }

  const product = await productsRepository.create({
    businessId,
    name: input.name,
    description: input.description,
    category: input.category,
    categoryId: input.categoryId,
    price: input.price,
    externalId: input.externalId,
    imageUrl: input.imageUrl,
    packaging: packagingToDb(input.packaging),
  });

  await bumpCatalogVersion(CatalogEntityType.PRODUCT, product.id, CatalogChangeType.UPSERT);
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
    ...(query.available !== undefined ? { available: query.available } : {}),
    ...(query.lowStock !== undefined ? { lowStock: query.lowStock } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
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
  if (input.categoryId) {
    await categoriesService.assertCategoryExists(input.categoryId);
  }

  const { packaging, ...fields } = input;
  const product = await productsRepository.update(productId, {
    ...fields,
    packaging: packagingToDb(packaging),
  });
  await bumpCatalogVersion(CatalogEntityType.PRODUCT, product.id, CatalogChangeType.UPSERT);
  return toDTO(product);
}

export async function deactivateProduct(
  businessId: string,
  productId: string,
): Promise<ProductDTO> {
  await assertProductExists(businessId, productId);
  const product = await productsRepository.update(productId, { active: false });
  await bumpCatalogVersion(CatalogEntityType.PRODUCT, product.id, CatalogChangeType.UPSERT);
  return toDTO(product);
}

export async function setProductAvailability(
  businessId: string,
  productId: string,
  input: SetProductAvailabilityInput,
): Promise<ProductDTO> {
  await assertProductExists(businessId, productId);
  const product = await productsRepository.update(productId, {
    ...(input.available !== undefined ? { available: input.available } : {}),
    ...(input.lowStock !== undefined ? { lowStock: input.lowStock } : {}),
  });
  await bumpCatalogVersion(CatalogEntityType.PRODUCT, product.id, CatalogChangeType.UPSERT);
  return toDTO(product);
}

// Fase 22: sube la imagen a Cloudinary (ver shared/cloudinary) y guarda solo la URL — el
// binario nunca toca Postgres ni el filesystem del servidor.
export async function setProductImage(
  businessId: string,
  productId: string,
  fileBuffer: Buffer,
): Promise<ProductDTO> {
  await assertProductExists(businessId, productId);
  const uploaded = await uploadImage(fileBuffer, `traelo/businesses/${businessId}/products`);
  const product = await productsRepository.update(productId, { imageUrl: uploaded.url });
  await bumpCatalogVersion(CatalogEntityType.PRODUCT, product.id, CatalogChangeType.UPSERT);
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

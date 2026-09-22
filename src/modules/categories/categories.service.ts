import { ConflictError, NotFoundError } from '../../shared/errors';
import { buildPaginationMeta, toSkipTake, type PaginationMeta } from '../../shared/http';
import { bumpCatalogVersion } from '../../shared/catalog';
import { uploadImage } from '../../shared/cloudinary';
import { CatalogEntityType, CatalogChangeType } from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';
import * as categoriesRepository from './categories.repository';
import type {
  CreateCategoryInput,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from './categories.dto';

export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  imageUrl: string | null;
  imageBlurhash: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

async function assertSlugAvailable(slug: string, excludeId?: string): Promise<void> {
  const existing = await categoriesRepository.findBySlug(slug);
  if (existing && existing.id !== excludeId) {
    throw new ConflictError('Ya existe una categoría con ese slug');
  }
}

export async function assertCategoryExists(id: string): Promise<CategoryDTO> {
  const category = await categoriesRepository.findById(id);
  if (!category) {
    throw new NotFoundError('Categoría no encontrada');
  }
  return category;
}

export async function createCategory(input: CreateCategoryInput): Promise<CategoryDTO> {
  await assertSlugAvailable(input.slug);

  const category = await categoriesRepository.create({
    name: input.name,
    slug: input.slug,
    icon: input.icon,
    sortOrder: input.sortOrder,
  });

  await bumpCatalogVersion(CatalogEntityType.CATEGORY, category.id, CatalogChangeType.UPSERT);
  return category;
}

export async function listCategories(
  query: ListCategoriesQuery,
): Promise<{ data: CategoryDTO[]; meta: PaginationMeta }> {
  const where: Prisma.CategoryWhereInput = {
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };

  const { skip, take } = toSkipTake(query);
  const [categories, total] = await Promise.all([
    categoriesRepository.findMany(where, skip, take),
    categoriesRepository.count(where),
  ]);

  return { data: categories, meta: buildPaginationMeta(query, total) };
}

export async function getCategory(id: string): Promise<CategoryDTO> {
  return assertCategoryExists(id);
}

export async function updateCategory(id: string, input: UpdateCategoryInput): Promise<CategoryDTO> {
  await assertCategoryExists(id);
  if (input.slug) {
    await assertSlugAvailable(input.slug, id);
  }

  // Un imageUrl puesto a mano no tiene blurhash calculado: se limpia el anterior para que la
  // app no muestre el placeholder de otra imagen (mismo criterio que Business.logoUrl).
  const category = await categoriesRepository.update(id, {
    ...input,
    ...(input.imageUrl !== undefined ? { imageBlurhash: null } : {}),
  });
  await bumpCatalogVersion(CatalogEntityType.CATEGORY, category.id, CatalogChangeType.UPSERT);
  return category;
}

export async function deactivateCategory(id: string): Promise<CategoryDTO> {
  await assertCategoryExists(id);
  const category = await categoriesRepository.update(id, { active: false });
  await bumpCatalogVersion(CatalogEntityType.CATEGORY, category.id, CatalogChangeType.UPSERT);
  return category;
}

// Sube la imagen a Cloudinary (ver shared/cloudinary) y guarda solo la URL — el binario nunca
// toca Postgres ni el filesystem del servidor. Mismo criterio que Business.setLogo.
export async function setCategoryImage(id: string, fileBuffer: Buffer): Promise<CategoryDTO> {
  await assertCategoryExists(id);
  const uploaded = await uploadImage(fileBuffer, `traelo/categories/${id}`);
  const category = await categoriesRepository.update(id, {
    imageUrl: uploaded.url,
    imageBlurhash: uploaded.blurhash,
  });
  await bumpCatalogVersion(CatalogEntityType.CATEGORY, category.id, CatalogChangeType.UPSERT);
  return category;
}

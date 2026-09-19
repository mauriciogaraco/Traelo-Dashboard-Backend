import { NotFoundError } from '../../shared/errors';
import { decimalToNumber } from '../../shared/prisma';
import { timeToString } from '../../shared/time';
import type { Prisma } from '../../generated/prisma/client';
import * as catalogRepository from './catalog.repository';
import * as categoriesRepository from '../categories/categories.repository';
import { isBusinessOpen } from '../businesses/business-status.service';
import { resolveEffectivePrice } from '../businesses/effective-price';
import { parsePackaging, type PackagingOption } from '../businesses/packaging';
import type {
  ListCatalogBusinessesQuery,
  ListCatalogChangesQuery,
  ListCatalogProductsQuery,
} from './catalog.dto';

export interface CatalogVersionDTO {
  version: number;
}

export interface CatalogChangeDTO {
  version: number;
  entityType: string;
  entityId: string;
  changeType: string;
  createdAt: Date;
}

export interface CatalogBusinessHoursDTO {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  closed: boolean;
}

export interface CatalogBusinessDTO {
  id: string;
  name: string;
  phone: string;
  address: string;
  acceptingOrders: boolean;
  // Resuelto con isBusinessOpen (horario + cierres excepcionales, hora de La Habana) — no se
  // filtran los negocios cerrados de la lista, se marcan, para que la app pueda mostrarlos
  // igual como "cerrado ahora" en vez de hacerlos desaparecer.
  isOpenNow: boolean;
  // Fase 22: con ?v=<updatedAt> para que un logo nuevo invalide el cache del móvil.
  logoUrl: string | null;
  // Placeholder mientras carga logoUrl (https://blurha.sh); null si el logo no tiene blurhash.
  logoBlurhash: string | null;
  hours: CatalogBusinessHoursDTO[];
}

export interface CatalogCategoryDTO {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sortOrder: number;
}

export interface CatalogProductOfferDTO {
  id: string;
  price: number;
  endsAt: Date;
}

export interface CatalogProductDTO {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  category: string | null;
  categoryId: string | null;
  categoryName: string | null;
  price: number | null;
  effectivePrice: number | null;
  offer: CatalogProductOfferDTO | null;
  // Fase 22: con ?v=<updatedAt> para que una imagen nueva invalide el cache del móvil.
  imageUrl: string | null;
  imageBlurhash: string | null;
  // Opciones de empaque a elegir al comprar ([{ name, price, capacity? }]); null = sin empaque.
  packaging: PackagingOption[] | null;
  // El catálogo solo lista productos con available=true (ver findCatalogProducts) — lowStock
  // es la señal de "todavía se puede comprar, pero se puede agotar pronto".
  lowStock: boolean;
}

export interface CatalogBootstrapBusinessDTO extends CatalogBusinessDTO {
  // "Relevantes" = desde hoy en adelante (ver findUpcomingClosures) — cierres pasados no le
  // sirven a una app que recién está arrancando.
  closures: { date: string; reason: string | null }[];
}

export interface CatalogBootstrapDTO {
  version: number;
  categories: CatalogCategoryDTO[];
  businesses: CatalogBootstrapBusinessDTO[];
  products: CatalogProductDTO[];
}

interface CatalogBusinessRecord {
  id: string;
  name: string;
  phone: string;
  address: string;
  acceptingOrders: boolean;
  logoUrl: string | null;
  logoBlurhash: string | null;
  updatedAt: Date;
  businessHours: { dayOfWeek: number; openTime: Date; closeTime: Date; closed: boolean }[];
}

interface CatalogProductRecord {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  category: string | null;
  categoryId: string | null;
  price: Prisma.Decimal | null;
  imageUrl: string | null;
  imageBlurhash: string | null;
  packaging: Prisma.JsonValue | null;
  lowStock: boolean;
  updatedAt: Date;
  categoryRef: { name: string } | null;
  offers: { id: string; price: Prisma.Decimal; endsAt: Date }[];
}

// ?v=<updatedAt> para que un cambio de imagen invalide agresivamente el cache del móvil
// (Fase 22) sin depender de que quien aloja la imagen cambie la URL en sí.
function versionedUrl(url: string | null, updatedAt: Date): string | null {
  if (!url) {
    return null;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${updatedAt.getTime()}`;
}

async function toBusinessDTO(
  business: CatalogBusinessRecord,
  now: Date,
): Promise<CatalogBusinessDTO> {
  const status = await isBusinessOpen(business.id, now);
  return {
    id: business.id,
    name: business.name,
    phone: business.phone,
    address: business.address,
    acceptingOrders: business.acceptingOrders,
    isOpenNow: status.open,
    logoUrl: versionedUrl(business.logoUrl, business.updatedAt),
    logoBlurhash: business.logoBlurhash,
    hours: business.businessHours.map((h) => ({
      dayOfWeek: h.dayOfWeek,
      openTime: timeToString(h.openTime),
      closeTime: timeToString(h.closeTime),
      closed: h.closed,
    })),
  };
}

function toCategoryDTO(category: {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sortOrder: number;
}): CatalogCategoryDTO {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    icon: category.icon,
    sortOrder: category.sortOrder,
  };
}

function toProductDTO(product: CatalogProductRecord): CatalogProductDTO {
  const activeOffer = product.offers[0] ?? null;
  const effective = resolveEffectivePrice(product.price, activeOffer);
  const offer: CatalogProductOfferDTO | null = activeOffer
    ? { id: activeOffer.id, price: decimalToNumber(activeOffer.price), endsAt: activeOffer.endsAt }
    : null;

  return {
    id: product.id,
    businessId: product.businessId,
    name: product.name,
    description: product.description,
    category: product.category,
    categoryId: product.categoryId,
    categoryName: product.categoryRef?.name ?? null,
    price: decimalToNumber(product.price),
    effectivePrice: effective?.price ?? null,
    offer,
    imageUrl: versionedUrl(product.imageUrl, product.updatedAt),
    imageBlurhash: product.imageBlurhash,
    packaging: parsePackaging(product.packaging),
    lowStock: product.lowStock,
  };
}

export async function getCatalogVersion(): Promise<CatalogVersionDTO> {
  const state = await catalogRepository.getCatalogState();
  return { version: state?.version ?? 0 };
}

export async function getCatalogChanges(
  query: ListCatalogChangesQuery,
): Promise<{ data: CatalogChangeDTO[]; latestVersion: number }> {
  const [changes, state] = await Promise.all([
    catalogRepository.findChangesSince(query.since, query.limit),
    catalogRepository.getCatalogState(),
  ]);

  return { data: changes, latestVersion: state?.version ?? 0 };
}

export async function listCatalogCategories(): Promise<CatalogCategoryDTO[]> {
  const categories = await categoriesRepository.findMany({ active: true }, 0, 500);
  return categories.map(toCategoryDTO);
}

export async function listCatalogBusinesses(
  query: ListCatalogBusinessesQuery,
): Promise<CatalogBusinessDTO[]> {
  const businesses = await catalogRepository.findCatalogBusinesses(query.search);
  const now = new Date();
  return Promise.all(businesses.map((business) => toBusinessDTO(business, now)));
}

export async function listCatalogProducts(
  businessId: string,
  query: ListCatalogProductsQuery,
): Promise<CatalogProductDTO[]> {
  const business = await catalogRepository.findCatalogBusinessById(businessId);
  if (!business) {
    throw new NotFoundError('Negocio no encontrado o no disponible');
  }

  const products = await catalogRepository.findCatalogProducts(businessId, {
    categoryId: query.categoryId,
    search: query.search,
  });

  return products.map(toProductDTO);
}

// Fase 3 del checklist de la app: todo lo necesario para que una instalación nueva pueda
// empezar a navegar en una sola llamada, en vez de encadenar categories+businesses+products
// por negocio. Pensado para el primer arranque; la sincronización incremental posterior usa
// getCatalogChanges, no este endpoint.
export async function getCatalogBootstrap(): Promise<CatalogBootstrapDTO> {
  const now = new Date();
  const [state, categories, businesses, products] = await Promise.all([
    catalogRepository.getCatalogState(),
    categoriesRepository.findMany({ active: true }, 0, 500),
    catalogRepository.findCatalogBusinesses(),
    catalogRepository.findAllCatalogProducts(),
  ]);

  const businessIds = businesses.map((business) => business.id);
  const closures = businessIds.length
    ? await catalogRepository.findUpcomingClosures(businessIds, now)
    : [];

  const closuresByBusiness = new Map<string, { date: Date; reason: string | null }[]>();
  for (const closure of closures) {
    const list = closuresByBusiness.get(closure.businessId) ?? [];
    list.push(closure);
    closuresByBusiness.set(closure.businessId, list);
  }

  const businessDTOs = await Promise.all(
    businesses.map(async (business): Promise<CatalogBootstrapBusinessDTO> => {
      const dto = await toBusinessDTO(business, now);
      const businessClosures = closuresByBusiness.get(business.id) ?? [];
      return {
        ...dto,
        closures: businessClosures.map((closure) => ({
          date: closure.date.toISOString().slice(0, 10),
          reason: closure.reason,
        })),
      };
    }),
  );

  return {
    version: state?.version ?? 0,
    categories: categories.map(toCategoryDTO),
    businesses: businessDTOs,
    products: products.map(toProductDTO),
  };
}

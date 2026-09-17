import { NotFoundError } from '../../shared/errors';
import { decimalToNumber } from '../../shared/prisma';
import { bumpCatalogVersion } from '../../shared/catalog';
import { CatalogEntityType, CatalogChangeType } from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';
import * as productsRepository from './products.repository';
import * as offersRepository from './product-offers.repository';
import type { CreateOfferInput, UpdateOfferInput } from './product-offers.dto';

export interface ProductOfferDTO {
  id: string;
  productId: string;
  price: number;
  startsAt: Date;
  endsAt: Date;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductOfferRecord {
  id: string;
  productId: string;
  price: Prisma.Decimal;
  startsAt: Date;
  endsAt: Date;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(offer: ProductOfferRecord): ProductOfferDTO {
  return {
    id: offer.id,
    productId: offer.productId,
    price: decimalToNumber(offer.price),
    startsAt: offer.startsAt,
    endsAt: offer.endsAt,
    active: offer.active,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  };
}

async function assertProductExists(businessId: string, productId: string): Promise<void> {
  const product = await productsRepository.findByIdForBusiness(productId, businessId);
  if (!product) {
    throw new NotFoundError('Producto no encontrado');
  }
}

async function assertOfferExists(productId: string, offerId: string): Promise<ProductOfferRecord> {
  const offer = await offersRepository.findByIdForProduct(offerId, productId);
  if (!offer) {
    throw new NotFoundError('Oferta no encontrada');
  }
  return offer;
}

export async function listOffers(
  businessId: string,
  productId: string,
): Promise<ProductOfferDTO[]> {
  await assertProductExists(businessId, productId);
  const offers = await offersRepository.findManyForProduct(productId);
  return offers.map(toDTO);
}

export async function createOffer(
  businessId: string,
  productId: string,
  input: CreateOfferInput,
): Promise<ProductOfferDTO> {
  await assertProductExists(businessId, productId);

  const offer = await offersRepository.create({
    productId,
    price: input.price,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  });

  await bumpCatalogVersion(CatalogEntityType.PRODUCT_OFFER, offer.id, CatalogChangeType.UPSERT);
  return toDTO(offer);
}

export async function updateOffer(
  businessId: string,
  productId: string,
  offerId: string,
  input: UpdateOfferInput,
): Promise<ProductOfferDTO> {
  await assertProductExists(businessId, productId);
  await assertOfferExists(productId, offerId);

  const offer = await offersRepository.update(offerId, input);
  await bumpCatalogVersion(CatalogEntityType.PRODUCT_OFFER, offer.id, CatalogChangeType.UPSERT);
  return toDTO(offer);
}

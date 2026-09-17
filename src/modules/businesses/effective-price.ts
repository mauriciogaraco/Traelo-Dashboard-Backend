import type { Prisma } from '../../generated/prisma/client';
import { decimalToNumber } from '../../shared/prisma';
import * as productsRepository from './products.repository';
import * as productOffersRepository from './product-offers.repository';

export interface EffectivePriceResult {
  price: number;
  offerId: string | null;
}

// Única decisión de "qué precio aplica": si hay una oferta vigente, gana la oferta; si no,
// el precio base. Nunca modifica Product.price ni la oferta — el resultado se usa para
// congelar OrderItem.unitPrice en el momento de la compra. Callers que ya tienen el precio
// base y la oferta vigente cargados (ej. catalog.service.ts, que trae las ofertas en batch
// vía Prisma include) deben llamar esta función directo, sin pasar por
// getEffectiveProductPrice, para no repetir un round-trip a la base.
export function resolveEffectivePrice(
  basePrice: Prisma.Decimal | null,
  activeOffer: { id: string; price: Prisma.Decimal } | null,
): EffectivePriceResult | null {
  if (activeOffer) {
    return { price: decimalToNumber(activeOffer.price), offerId: activeOffer.id };
  }
  if (basePrice === null) {
    return null;
  }
  return { price: decimalToNumber(basePrice), offerId: null };
}

// Conveniencia para callers que solo tienen el productId (no cargaron el producto ni la
// oferta de antemano). Devuelve null si el producto no existe o no tiene precio configurado.
export async function getEffectiveProductPrice(
  productId: string,
  dateTime: Date,
): Promise<EffectivePriceResult | null> {
  const product = await productsRepository.findById(productId);
  if (!product) {
    return null;
  }
  const activeOffer = await productOffersRepository.findActiveForProduct(productId, dateTime);
  return resolveEffectivePrice(product.price, activeOffer);
}

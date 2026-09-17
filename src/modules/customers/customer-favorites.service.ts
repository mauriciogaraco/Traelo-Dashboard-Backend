import { NotFoundError } from '../../shared/errors';
import { decimalToNumber } from '../../shared/prisma';
import * as businessesRepository from '../businesses/businesses.repository';
import * as customersService from './customers.service';
import * as favoritesRepository from './customer-favorites.repository';

export interface FavoriteBusinessDTO {
  businessId: string;
  name: string;
  phone: string;
  address: string;
  createdAt: Date;
}

export interface FavoriteProductDTO {
  productId: string;
  businessId: string;
  name: string;
  price: number | null;
  createdAt: Date;
}

export async function listFavoriteBusinesses(customerId: string): Promise<FavoriteBusinessDTO[]> {
  await customersService.assertCustomerExists(customerId);
  const favorites = await favoritesRepository.findFavoriteBusinesses(customerId);
  return favorites.map((favorite) => ({
    businessId: favorite.business.id,
    name: favorite.business.name,
    phone: favorite.business.phone,
    address: favorite.business.address,
    createdAt: favorite.createdAt,
  }));
}

export async function addFavoriteBusiness(customerId: string, businessId: string): Promise<void> {
  await customersService.assertCustomerExists(customerId);
  const business = await businessesRepository.findById(businessId);
  if (!business) {
    throw new NotFoundError('Negocio no encontrado');
  }
  await favoritesRepository.addFavoriteBusiness(customerId, businessId);
}

export async function removeFavoriteBusiness(
  customerId: string,
  businessId: string,
): Promise<void> {
  await customersService.assertCustomerExists(customerId);
  await favoritesRepository.removeFavoriteBusiness(customerId, businessId);
}

export async function listFavoriteProducts(customerId: string): Promise<FavoriteProductDTO[]> {
  await customersService.assertCustomerExists(customerId);
  const favorites = await favoritesRepository.findFavoriteProducts(customerId);
  return favorites.map((favorite) => ({
    productId: favorite.product.id,
    businessId: favorite.product.businessId,
    name: favorite.product.name,
    price: decimalToNumber(favorite.product.price),
    createdAt: favorite.createdAt,
  }));
}

export async function addFavoriteProduct(customerId: string, productId: string): Promise<void> {
  await customersService.assertCustomerExists(customerId);
  const product = await favoritesRepository.findProductById(productId);
  if (!product) {
    throw new NotFoundError('Producto no encontrado');
  }
  await favoritesRepository.addFavoriteProduct(customerId, productId);
}

export async function removeFavoriteProduct(customerId: string, productId: string): Promise<void> {
  await customersService.assertCustomerExists(customerId);
  await favoritesRepository.removeFavoriteProduct(customerId, productId);
}

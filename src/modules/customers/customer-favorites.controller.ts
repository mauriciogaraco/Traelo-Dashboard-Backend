import type { Request, Response } from 'express';
import { sendNoContent, sendOk } from '../../shared/http';
import * as favoritesService from './customer-favorites.service';
import type { FavoriteBusinessParams, FavoriteProductParams } from './customer-favorites.dto';

export async function listFavoriteBusinesses(req: Request, res: Response): Promise<void> {
  const { id: customerId } = req.params as unknown as { id: string };
  const favorites = await favoritesService.listFavoriteBusinesses(customerId);
  sendOk(res, favorites);
}

export async function addFavoriteBusiness(req: Request, res: Response): Promise<void> {
  const { id: customerId, businessId } = req.params as unknown as FavoriteBusinessParams;
  await favoritesService.addFavoriteBusiness(customerId, businessId);
  sendOk(res, { businessId });
}

export async function removeFavoriteBusiness(req: Request, res: Response): Promise<void> {
  const { id: customerId, businessId } = req.params as unknown as FavoriteBusinessParams;
  await favoritesService.removeFavoriteBusiness(customerId, businessId);
  sendNoContent(res);
}

export async function listFavoriteProducts(req: Request, res: Response): Promise<void> {
  const { id: customerId } = req.params as unknown as { id: string };
  const favorites = await favoritesService.listFavoriteProducts(customerId);
  sendOk(res, favorites);
}

export async function addFavoriteProduct(req: Request, res: Response): Promise<void> {
  const { id: customerId, productId } = req.params as unknown as FavoriteProductParams;
  await favoritesService.addFavoriteProduct(customerId, productId);
  sendOk(res, { productId });
}

export async function removeFavoriteProduct(req: Request, res: Response): Promise<void> {
  const { id: customerId, productId } = req.params as unknown as FavoriteProductParams;
  await favoritesService.removeFavoriteProduct(customerId, productId);
  sendNoContent(res);
}

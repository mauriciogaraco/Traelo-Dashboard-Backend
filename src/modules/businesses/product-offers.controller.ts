import type { Request, Response } from 'express';
import { sendCreated, sendOk } from '../../shared/http';
import * as offersService from './product-offers.service';
import type { CreateOfferInput, OfferParams, UpdateOfferInput } from './product-offers.dto';

export async function listOffers(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId } = req.params as unknown as { id: string; productId: string };
  const offers = await offersService.listOffers(businessId, productId);
  sendOk(res, offers);
}

export async function createOffer(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId } = req.params as unknown as { id: string; productId: string };
  const offer = await offersService.createOffer(
    businessId,
    productId,
    req.body as CreateOfferInput,
  );
  sendCreated(res, offer);
}

export async function updateOffer(req: Request, res: Response): Promise<void> {
  const { id: businessId, productId, offerId } = req.params as unknown as OfferParams;
  const offer = await offersService.updateOffer(
    businessId,
    productId,
    offerId,
    req.body as UpdateOfferInput,
  );
  sendOk(res, offer);
}

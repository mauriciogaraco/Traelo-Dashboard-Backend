import type { Request, Response } from 'express';
import { sendCreated, sendOk } from '../../shared/http';
import * as customerOrdersService from '../customers/customer-orders.service';
import type { CheckoutOrderInput, CheckoutQuoteInput } from './checkout.dto';

export async function createOrder(req: Request, res: Response): Promise<void> {
  const order = await customerOrdersService.createCheckoutOrder(
    req.body as CheckoutOrderInput,
    req.customer?.id,
  );
  sendCreated(res, order);
}

export async function quote(req: Request, res: Response): Promise<void> {
  sendOk(res, await customerOrdersService.quoteCheckout(req.body as CheckoutQuoteInput, req.customer?.id));
}

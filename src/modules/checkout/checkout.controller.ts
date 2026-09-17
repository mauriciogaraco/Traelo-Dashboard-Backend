import type { Request, Response } from 'express';
import { sendCreated } from '../../shared/http';
import * as customerOrdersService from '../customers/customer-orders.service';
import type { CheckoutOrderInput } from './checkout.dto';

export async function createOrder(req: Request, res: Response): Promise<void> {
  const order = await customerOrdersService.createCheckoutOrder(req.body as CheckoutOrderInput);
  sendCreated(res, order);
}

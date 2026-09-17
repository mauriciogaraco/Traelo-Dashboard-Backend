import type { Request, Response } from 'express';
import { sendCreated, sendOk, sendPaginated } from '../../shared/http';
import * as customerOrdersService from './customer-orders.service';
import type {
  CreateAppOrderInput,
  CustomerOrderParams,
  ListCustomerOrdersQuery,
} from './customer-orders.dto';

export async function createOrder(req: Request, res: Response): Promise<void> {
  const { id: customerId } = req.params as unknown as { id: string };
  const order = await customerOrdersService.createAppOrder(
    customerId,
    req.body as CreateAppOrderInput,
  );
  sendCreated(res, order);
}

export async function listOrders(req: Request, res: Response): Promise<void> {
  const { id: customerId } = req.params as unknown as { id: string };
  const query = req.query as unknown as ListCustomerOrdersQuery;
  const { data, meta } = await customerOrdersService.listCustomerOrders(customerId, query);
  sendPaginated(res, data, meta);
}

export async function getOrderStatus(req: Request, res: Response): Promise<void> {
  const { id: customerId, orderId } = req.params as unknown as CustomerOrderParams;
  const status = await customerOrdersService.getCustomerOrderStatus(customerId, orderId);
  sendOk(res, status);
}

export async function repeatOrder(req: Request, res: Response): Promise<void> {
  const { id: customerId, orderId } = req.params as unknown as CustomerOrderParams;
  const cart = await customerOrdersService.repeatOrder(customerId, orderId);
  sendOk(res, cart);
}

import type { Request, Response } from 'express';
import { sendCreated, sendNoContent, sendOk, sendPaginated, type IdParam } from '../../shared/http';
import { UnauthorizedError } from '../../shared/errors';
import { Role } from '../../generated/prisma/enums';
import * as ordersService from './orders.service';
import * as deliverersService from '../deliverers/deliverers.service';
import type {
  AssignOrderInput,
  BulkCompleteOrdersInput,
  CreateOrderInput,
  ListOrdersQuery,
  UpdateOrderInput,
  UpdateOrderStatusInput,
} from './orders.dto';

async function resolveDelivererScope(req: Request): Promise<string | undefined> {
  if (req.user?.role !== Role.DELIVERER) {
    return undefined;
  }
  const deliverer = await deliverersService.getDelivererByUserId(req.user.sub);
  return deliverer.id;
}

export async function listOrders(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListOrdersQuery;
  const scopeDelivererId = await resolveDelivererScope(req);
  const { data, meta } = await ordersService.listOrders(query, scopeDelivererId);
  sendPaginated(res, data, meta);
}

export async function createOrder(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  const order = await ordersService.createOrder(req.body as CreateOrderInput, req.user.sub);
  sendCreated(res, order);
}

export async function getOrder(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const scopeDelivererId = await resolveDelivererScope(req);
  const order = await ordersService.getOrderById(id, scopeDelivererId);
  sendOk(res, order);
}

export async function updateOrder(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const order = await ordersService.updateOrder(id, req.body as UpdateOrderInput);
  sendOk(res, order);
}

export async function deleteOrder(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  await ordersService.deleteOrder(id);
  sendNoContent(res);
}

export async function assignOrder(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const order = await ordersService.assignOrder(id, req.body as AssignOrderInput);
  sendOk(res, order);
}

export async function updateOrderStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const order = await ordersService.updateOrderStatus(id, req.body as UpdateOrderStatusInput);
  sendOk(res, order);
}

export async function bulkCompleteOrders(req: Request, res: Response): Promise<void> {
  const { ids } = req.body as BulkCompleteOrdersInput;
  const result = await ordersService.bulkCompleteOrders(ids);
  sendOk(res, result);
}

import type { Request, Response } from 'express';
import { sendCreated, sendOk, sendPaginated, type PaginationQuery } from '../../shared/http';
import * as subscriptionsService from './subscriptions.service';
import type {
  CreateSubscriptionInput,
  SubscriptionParams,
  UpdateSubscriptionInput,
} from './subscriptions.dto';

export async function listSubscriptions(req: Request, res: Response): Promise<void> {
  const { id: businessId } = req.params as unknown as { id: string };
  const query = req.query as unknown as PaginationQuery;
  const { data, meta } = await subscriptionsService.listSubscriptions(businessId, query);
  sendPaginated(res, data, meta);
}

export async function createSubscription(req: Request, res: Response): Promise<void> {
  const { id: businessId } = req.params as unknown as { id: string };
  const subscription = await subscriptionsService.createSubscription(
    businessId,
    req.body as CreateSubscriptionInput,
  );
  sendCreated(res, subscription);
}

export async function getSubscription(req: Request, res: Response): Promise<void> {
  const { id: businessId, subId } = req.params as unknown as SubscriptionParams;
  const subscription = await subscriptionsService.getSubscription(businessId, subId);
  sendOk(res, subscription);
}

export async function updateSubscription(req: Request, res: Response): Promise<void> {
  const { id: businessId, subId } = req.params as unknown as SubscriptionParams;
  const subscription = await subscriptionsService.updateSubscription(
    businessId,
    subId,
    req.body as UpdateSubscriptionInput,
  );
  sendOk(res, subscription);
}

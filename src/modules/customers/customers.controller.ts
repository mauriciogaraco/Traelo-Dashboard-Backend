import type { Request, Response } from 'express';
import { sendOk } from '../../shared/http';
import * as customersService from './customers.service';
import type { CustomerIdParam, UpdateCustomerInput } from './customers.dto';

export async function getCustomer(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as CustomerIdParam;
  const customer = await customersService.getCustomer(id);
  sendOk(res, customer);
}

export async function updateCustomer(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as CustomerIdParam;
  const customer = await customersService.updateCustomer(id, req.body as UpdateCustomerInput);
  sendOk(res, customer);
}

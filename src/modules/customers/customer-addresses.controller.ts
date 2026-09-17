import type { Request, Response } from 'express';
import { sendCreated, sendNoContent, sendOk } from '../../shared/http';
import * as addressesService from './customer-addresses.service';
import type {
  AddressParams,
  CreateAddressInput,
  UpdateAddressInput,
} from './customer-addresses.dto';

export async function listAddresses(req: Request, res: Response): Promise<void> {
  const { id: customerId } = req.params as unknown as { id: string };
  const addresses = await addressesService.listAddresses(customerId);
  sendOk(res, addresses);
}

export async function createAddress(req: Request, res: Response): Promise<void> {
  const { id: customerId } = req.params as unknown as { id: string };
  const address = await addressesService.createAddress(customerId, req.body as CreateAddressInput);
  sendCreated(res, address);
}

export async function updateAddress(req: Request, res: Response): Promise<void> {
  const { id: customerId, addressId } = req.params as unknown as AddressParams;
  const address = await addressesService.updateAddress(
    customerId,
    addressId,
    req.body as UpdateAddressInput,
  );
  sendOk(res, address);
}

export async function deleteAddress(req: Request, res: Response): Promise<void> {
  const { id: customerId, addressId } = req.params as unknown as AddressParams;
  await addressesService.deleteAddress(customerId, addressId);
  sendNoContent(res);
}

import type { Request, Response } from 'express';
import { sendCreated, sendNoContent, sendOk } from '../../shared/http';
import * as devicesService from './customer-devices.service';
import type { DeviceParams, RegisterDeviceInput, UpdateDeviceInput } from './customer-devices.dto';

export async function registerDevice(req: Request, res: Response): Promise<void> {
  const { id: customerId } = req.params as unknown as { id: string };
  const device = await devicesService.registerDevice(customerId, req.body as RegisterDeviceInput);
  sendCreated(res, device);
}

export async function updateDevice(req: Request, res: Response): Promise<void> {
  const { id: customerId, deviceId } = req.params as unknown as DeviceParams;
  const device = await devicesService.updateDevice(
    customerId,
    deviceId,
    req.body as UpdateDeviceInput,
  );
  sendOk(res, device);
}

export async function deleteDevice(req: Request, res: Response): Promise<void> {
  const { id: customerId, deviceId } = req.params as unknown as DeviceParams;
  await devicesService.deleteDevice(customerId, deviceId);
  sendNoContent(res);
}

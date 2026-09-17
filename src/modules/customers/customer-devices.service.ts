import { NotFoundError } from '../../shared/errors';
import * as customersService from './customers.service';
import * as devicesRepository from './customer-devices.repository';
import type { RegisterDeviceInput, UpdateDeviceInput } from './customer-devices.dto';
import type { DevicePlatform } from '../../generated/prisma/enums';

export interface CustomerDeviceDTO {
  id: string;
  customerId: string;
  platform: DevicePlatform;
  pushToken: string | null;
  appVersion: string | null;
  active: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

async function assertDeviceExists(
  customerId: string,
  deviceId: string,
): Promise<CustomerDeviceDTO> {
  const device = await devicesRepository.findByIdForCustomer(deviceId, customerId);
  if (!device) {
    throw new NotFoundError('Dispositivo no encontrado');
  }
  return device;
}

export async function registerDevice(
  customerId: string,
  input: RegisterDeviceInput,
): Promise<CustomerDeviceDTO> {
  await customersService.assertCustomerExists(customerId);

  return devicesRepository.create({
    customerId,
    platform: input.platform,
    pushToken: input.pushToken,
    appVersion: input.appVersion,
    lastSeenAt: new Date(),
  });
}

export async function updateDevice(
  customerId: string,
  deviceId: string,
  input: UpdateDeviceInput,
): Promise<CustomerDeviceDTO> {
  await assertDeviceExists(customerId, deviceId);

  return devicesRepository.update(deviceId, {
    ...input,
    lastSeenAt: new Date(),
  });
}

export async function deleteDevice(customerId: string, deviceId: string): Promise<void> {
  await assertDeviceExists(customerId, deviceId);
  await devicesRepository.deleteById(deviceId);
}

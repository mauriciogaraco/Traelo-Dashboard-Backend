import { NotFoundError } from '../../shared/errors';
import * as customersService from './customers.service';
import * as addressesRepository from './customer-addresses.repository';
import type { CreateAddressInput, UpdateAddressInput } from './customer-addresses.dto';

export interface CustomerAddressDTO {
  id: string;
  customerId: string;
  label: string;
  address: string;
  reference: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

async function assertAddressExists(
  customerId: string,
  addressId: string,
): Promise<CustomerAddressDTO> {
  const address = await addressesRepository.findByIdForCustomer(addressId, customerId);
  if (!address) {
    throw new NotFoundError('Dirección no encontrada');
  }
  return address;
}

export async function listAddresses(customerId: string): Promise<CustomerAddressDTO[]> {
  await customersService.assertCustomerExists(customerId);
  return addressesRepository.findManyForCustomer(customerId);
}

export async function createAddress(
  customerId: string,
  input: CreateAddressInput,
): Promise<CustomerAddressDTO> {
  await customersService.assertCustomerExists(customerId);
  return addressesRepository.create(customerId, {
    label: input.label,
    address: input.address,
    reference: input.reference,
    isDefault: input.isDefault ?? false,
  });
}

export async function updateAddress(
  customerId: string,
  addressId: string,
  input: UpdateAddressInput,
): Promise<CustomerAddressDTO> {
  await assertAddressExists(customerId, addressId);
  return addressesRepository.update(customerId, addressId, input);
}

export async function deleteAddress(customerId: string, addressId: string): Promise<void> {
  await assertAddressExists(customerId, addressId);
  await addressesRepository.deleteById(addressId);
}

import { NotFoundError } from '../../shared/errors';
import { NO_STORED_LOCATION, toStoredLocation } from '../../shared/location';
import type { LocationSource } from '../../generated/prisma/enums';
import * as customersService from './customers.service';
import * as addressesRepository from './customer-addresses.repository';
import type { CreateAddressInput, UpdateAddressInput } from './customer-addresses.dto';

export interface AddressLocationDTO {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  source: LocationSource;
}

export interface CustomerAddressDTO {
  id: string;
  customerId: string;
  label: string;
  address: string;
  reference: string | null;
  isDefault: boolean;
  // null = la dirección no tiene pin (lo normal: es opcional).
  location: AddressLocationDTO | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AddressRecord {
  id: string;
  customerId: string;
  label: string;
  address: string;
  reference: string | null;
  isDefault: boolean;
  latitude: number | null;
  longitude: number | null;
  locationSource: LocationSource | null;
  locationAccuracy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// DTO explícito: las columnas planas de ubicación salen agrupadas en `location`, y una fila
// con coordenadas a medias (no debería existir) se trata como "sin ubicación".
export function toAddressDTO(record: AddressRecord): CustomerAddressDTO {
  const hasLocation = record.latitude !== null && record.longitude !== null;
  return {
    id: record.id,
    customerId: record.customerId,
    label: record.label,
    address: record.address,
    reference: record.reference,
    isDefault: record.isDefault,
    location: hasLocation
      ? {
          latitude: record.latitude as number,
          longitude: record.longitude as number,
          accuracy: record.locationAccuracy,
          source: record.locationSource ?? 'MANUAL_PIN',
        }
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function assertAddressExists(customerId: string, addressId: string): Promise<AddressRecord> {
  const address = await addressesRepository.findByIdForCustomer(addressId, customerId);
  if (!address) {
    throw new NotFoundError('Dirección no encontrada');
  }
  return address;
}

export async function listAddresses(customerId: string): Promise<CustomerAddressDTO[]> {
  await customersService.assertCustomerExists(customerId);
  const addresses = await addressesRepository.findManyForCustomer(customerId);
  return addresses.map(toAddressDTO);
}

export async function createAddress(
  customerId: string,
  input: CreateAddressInput,
): Promise<CustomerAddressDTO> {
  await customersService.assertCustomerExists(customerId);
  const created = await addressesRepository.create(customerId, {
    label: input.label,
    address: input.address,
    reference: input.reference,
    isDefault: input.isDefault ?? false,
    ...(input.location ? toStoredLocation(input.location) : {}),
  });
  return toAddressDTO(created);
}

export async function updateAddress(
  customerId: string,
  addressId: string,
  input: UpdateAddressInput,
): Promise<CustomerAddressDTO> {
  await assertAddressExists(customerId, addressId);
  const { location, ...fields } = input;
  const updated = await addressesRepository.update(customerId, addressId, {
    ...fields,
    // undefined = no tocar; null = quitar el pin; objeto = fijarlo. Las direcciones de pedidos ya
    // hechos no cambian: cada Order guarda su propio snapshot.
    ...(location === null ? NO_STORED_LOCATION : {}),
    ...(location ? toStoredLocation(location) : {}),
  });
  return toAddressDTO(updated);
}

export async function deleteAddress(customerId: string, addressId: string): Promise<void> {
  await assertAddressExists(customerId, addressId);
  await addressesRepository.deleteById(addressId);
}

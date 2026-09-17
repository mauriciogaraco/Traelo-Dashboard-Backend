import { ConflictError, NotFoundError } from '../../shared/errors';
import * as customersRepository from './customers.repository';
import type { CreateCustomerInput, UpdateCustomerInput } from './customers.dto';

export interface CustomerDTO {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  active: boolean;
  lastOrderAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function assertCustomerExists(id: string): Promise<CustomerDTO> {
  const customer = await customersRepository.findById(id);
  if (!customer) {
    throw new NotFoundError('Cliente no encontrado');
  }
  return customer;
}

export async function createCustomer(input: CreateCustomerInput): Promise<CustomerDTO> {
  const existing = await customersRepository.findByPhone(input.phone);
  if (existing) {
    throw new ConflictError('Ya existe un cliente registrado con ese teléfono');
  }

  return customersRepository.create({
    name: input.name,
    phone: input.phone,
    email: input.email,
  });
}

export async function getCustomer(id: string): Promise<CustomerDTO> {
  return assertCustomerExists(id);
}

export async function updateCustomer(id: string, input: UpdateCustomerInput): Promise<CustomerDTO> {
  await assertCustomerExists(id);
  return customersRepository.update(id, input);
}

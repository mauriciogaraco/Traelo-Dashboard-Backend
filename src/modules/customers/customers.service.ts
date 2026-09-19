import { NotFoundError } from '../../shared/errors';
import * as customersRepository from './customers.repository';
import type { UpdateCustomerInput } from './customers.dto';

// DTO explícito: NUNCA se devuelve la fila de Prisma tal cual (traería passwordHash y
// cualquier columna que se agregue después). Todo lo que sale de la API sobre un cliente pasa
// por toCustomerDTO.
export interface CustomerDTO {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  lastOrderAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toCustomerDTO(customer: CustomerDTO): CustomerDTO {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    phoneVerified: customer.phoneVerified,
    emailVerified: customer.emailVerified,
    lastOrderAt: customer.lastOrderAt,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export async function assertCustomerExists(id: string): Promise<CustomerDTO> {
  const customer = await customersRepository.findById(id);
  if (!customer || !customer.active) {
    throw new NotFoundError('Cliente no encontrado');
  }
  return toCustomerDTO(customer);
}

export async function getCustomer(id: string): Promise<CustomerDTO> {
  return assertCustomerExists(id);
}

export async function updateCustomer(id: string, input: UpdateCustomerInput): Promise<CustomerDTO> {
  await assertCustomerExists(id);
  // Cambiar el email lo deja sin verificar (hoy nunca hay verificación, pero el flag no debe
  // quedar en true por error si algún día existe).
  const updated = await customersRepository.update(id, {
    ...input,
    ...(input.email !== undefined ? { emailVerified: false } : {}),
  });
  return toCustomerDTO(updated);
}

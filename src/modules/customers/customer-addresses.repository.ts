import { prisma } from '../../shared/prisma';

interface AddressData {
  label: string;
  address: string;
  reference?: string;
  isDefault: boolean;
}

export function findManyForCustomer(customerId: string) {
  return prisma.customerAddress.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } });
}

export function findByIdForCustomer(id: string, customerId: string) {
  return prisma.customerAddress.findFirst({ where: { id, customerId } });
}

// Si isDefault=true, primero desmarca cualquier otra dirección del cliente en la misma
// transacción — nunca queda más de un "isDefault" a la vez.
export function create(customerId: string, data: AddressData) {
  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.customerAddress.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.customerAddress.create({ data: { customerId, ...data } });
  });
}

export function update(customerId: string, addressId: string, data: Partial<AddressData>) {
  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.customerAddress.updateMany({
        where: { customerId, isDefault: true, id: { not: addressId } },
        data: { isDefault: false },
      });
    }
    return tx.customerAddress.update({ where: { id: addressId }, data });
  });
}

export function deleteById(id: string) {
  return prisma.customerAddress.delete({ where: { id } });
}

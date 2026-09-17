import { prisma } from '../../shared/prisma';

export function findFavoriteBusinesses(customerId: string) {
  return prisma.customerFavoriteBusiness.findMany({
    where: { customerId },
    include: { business: { select: { id: true, name: true, phone: true, address: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

// upsert con update:{} hace el "agregar favorito" idempotente: llamarlo dos veces con el
// mismo negocio no falla ni duplica la fila (@@unique([customerId, businessId])).
export function addFavoriteBusiness(customerId: string, businessId: string) {
  return prisma.customerFavoriteBusiness.upsert({
    where: { customerId_businessId: { customerId, businessId } },
    update: {},
    create: { customerId, businessId },
  });
}

export function removeFavoriteBusiness(customerId: string, businessId: string) {
  return prisma.customerFavoriteBusiness.deleteMany({ where: { customerId, businessId } });
}

export function findFavoriteProducts(customerId: string) {
  return prisma.customerFavoriteProduct.findMany({
    where: { customerId },
    include: { product: { select: { id: true, businessId: true, name: true, price: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export function addFavoriteProduct(customerId: string, productId: string) {
  return prisma.customerFavoriteProduct.upsert({
    where: { customerId_productId: { customerId, productId } },
    update: {},
    create: { customerId, productId },
  });
}

export function removeFavoriteProduct(customerId: string, productId: string) {
  return prisma.customerFavoriteProduct.deleteMany({ where: { customerId, productId } });
}

export function findProductById(productId: string) {
  return prisma.product.findUnique({ where: { id: productId } });
}

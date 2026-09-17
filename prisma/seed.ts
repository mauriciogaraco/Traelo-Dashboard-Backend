import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.systemConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      defaultDelivererCommissionPercentage: 60,
    },
  });

  await prisma.catalogState.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      version: 1,
    },
  });

  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;

  if (!ownerEmail || !ownerPassword) {
    throw new Error('SEED_OWNER_EMAIL y SEED_OWNER_PASSWORD son requeridos en .env para el seed.');
  }

  const passwordHash = await bcrypt.hash(ownerPassword, 12);

  await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      name: 'Owner',
      email: ownerEmail,
      passwordHash,
      role: 'OWNER',
    },
  });

  // Categorías: lista de referencia real del catálogo (no son datos de prueba), se pueblan
  // siempre, incluso en producción — son idempotentes vía upsert por slug.
  await Promise.all(
    [
      { name: 'Comida Rápida', slug: 'comida-rapida', icon: '🍔', sortOrder: 1 },
      { name: 'Pizzas', slug: 'pizzas', icon: '🍕', sortOrder: 2 },
      { name: 'Postres', slug: 'postres', icon: '🍰', sortOrder: 3 },
      { name: 'Bebidas', slug: 'bebidas', icon: '🥤', sortOrder: 4 },
      { name: 'Farmacia', slug: 'farmacia', icon: '💊', sortOrder: 5 },
      { name: 'Mercado', slug: 'mercado', icon: '🛒', sortOrder: 6 },
    ].map((category) =>
      prisma.category.upsert({ where: { slug: category.slug }, update: {}, create: category }),
    ),
  );

  if (process.env.NODE_ENV === 'production') {
    console.log('Seed completado: SystemConfig, CatalogState, categorías y usuario OWNER listos.');
    return;
  }

  await seedSampleCatalog();

  console.log(
    'Seed completado: SystemConfig, CatalogState, categorías, usuario OWNER y datos de prueba (negocio/producto/cliente demo) listos.',
  );
}

// Datos de ejemplo para desarrollo local — pensados para poder probar a mano, de punta a
// punta, todo lo agregado para la app móvil (categorías/horario/oferta/cliente/dirección/
// favorito/pedido) sin tener que cargar cada fila manualmente. Nunca se corre en producción
// (ver guard en main()). Usa ids fijos y legibles (en vez del cuid() por defecto) para que el
// seed sea idempotente y se pueda volver a correr sin duplicar filas.
async function seedSampleCatalog() {
  const pizzasCategory = await prisma.category.findUniqueOrThrow({ where: { slug: 'pizzas' } });

  const pizzeria = await prisma.business.upsert({
    where: { id: 'seed-business-pizzeria' },
    update: {},
    create: {
      id: 'seed-business-pizzeria',
      name: 'Pizzería Demo',
      phone: '+53 5555 0001',
      address: 'Calle 23 #456, Vedado, La Habana',
      commissionType: 'PERCENTAGE',
      commissionPercentage: 10,
      deliveryFeeBase: 250,
    },
  });

  // Ejemplo de negocio en la tarifa de mensajería más cara (ver delivery-fee-calculator.ts).
  const dlmDemo = await prisma.business.upsert({
    where: { id: 'seed-business-dlm' },
    update: {},
    create: {
      id: 'seed-business-dlm',
      name: 'DLM Demo',
      phone: '+53 5555 0002',
      address: 'Calle 5ta #789, Miramar, La Habana',
      commissionType: 'PERCENTAGE',
      commissionPercentage: 10,
      deliveryFeeBase: 350,
    },
  });

  await Promise.all(
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) =>
      prisma.businessHours.upsert({
        where: { businessId_dayOfWeek: { businessId: pizzeria.id, dayOfWeek } },
        update: {},
        create: {
          businessId: pizzeria.id,
          dayOfWeek,
          openTime: new Date(Date.UTC(1970, 0, 1, 9, 0)),
          closeTime: new Date(Date.UTC(1970, 0, 1, 22, 0)),
          closed: false,
        },
      }),
    ),
  );

  const margarita = await prisma.product.upsert({
    where: { id: 'seed-product-margarita' },
    update: {},
    create: {
      id: 'seed-product-margarita',
      businessId: pizzeria.id,
      name: 'Pizza Margarita',
      categoryId: pizzasCategory.id,
      price: 500,
      available: true,
    },
  });

  await prisma.product.upsert({
    where: { id: 'seed-product-pepperoni' },
    update: {},
    create: {
      id: 'seed-product-pepperoni',
      businessId: pizzeria.id,
      name: 'Pizza Pepperoni',
      categoryId: pizzasCategory.id,
      price: 600,
      available: true,
    },
  });

  // Oferta vigente sobre la Margarita, para poder probar effectivePrice en /catalog y en la
  // creación de pedidos de la app.
  await prisma.productOffer.upsert({
    where: { id: 'seed-offer-margarita' },
    update: {},
    create: {
      id: 'seed-offer-margarita',
      productId: margarita.id,
      price: 400,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      active: true,
    },
  });

  const customer = await prisma.customer.upsert({
    where: { id: 'seed-customer-demo' },
    update: {},
    create: {
      id: 'seed-customer-demo',
      name: 'Cliente Demo',
      phone: '+53 5555 9999',
      email: 'cliente.demo@example.com',
    },
  });

  await prisma.customerAddress.upsert({
    where: { id: 'seed-address-demo' },
    update: {},
    create: {
      id: 'seed-address-demo',
      customerId: customer.id,
      label: 'Casa',
      address: 'Calle 10 #123, Plaza, La Habana',
      isDefault: true,
    },
  });

  await prisma.customerFavoriteBusiness.upsert({
    where: { customerId_businessId: { customerId: customer.id, businessId: pizzeria.id } },
    update: {},
    create: { customerId: customer.id, businessId: pizzeria.id },
  });

  console.log(
    `  → Datos de prueba: Pizzería Demo (${pizzeria.id}), DLM Demo (${dlmDemo.id}), Cliente Demo (${customer.id})`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

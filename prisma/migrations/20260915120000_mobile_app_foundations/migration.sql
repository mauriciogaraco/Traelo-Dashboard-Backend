-- Base de datos para la futura app móvil (React Native): clientes separados de los
-- usuarios internos, direcciones, favoritos, dispositivos, categorías estructuradas,
-- ofertas, horarios de negocio y versionado de catálogo para sincronización incremental.
--
-- Todo es aditivo/relajante y no destructivo:
--   * Ninguna columna ni tabla existente se elimina ni se renombra.
--   * Las columnas nuevas en tablas existentes (orders, businesses, products) son
--     NULLABLE o llevan DEFAULT, así que los pedidos/negocios/productos históricos
--     quedan intactos sin necesidad de backfill manual.
--   * Los dos índices que cambian de forma (businesses, products) se recrean como
--     superconjunto del índice anterior: cualquier consulta que usaba el índice viejo
--     sigue funcionando igual con el nuevo.
--   * El único cambio sobre una columna existente es relajar orders.registeredByUserId a
--     NULLABLE (DROP NOT NULL) — nunca puede fallar por datos existentes, todos los pedidos
--     ya tienen un valor no nulo ahí.

-- ── Enums ────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('APP', 'WEB', 'MANUAL', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "CatalogEntityType" AS ENUM ('BUSINESS', 'PRODUCT', 'CATEGORY', 'BUSINESS_HOURS', 'BUSINESS_CLOSURE', 'PRODUCT_OFFER');

-- CreateEnum
CREATE TYPE "CatalogChangeType" AS ENUM ('UPSERT', 'DELETE');

-- ── Clientes (app móvil) ─────────────────────────────────

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastOrderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "reference" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_devices" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "pushToken" TEXT,
    "appVersion" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_favorite_businesses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_favorite_businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_favorite_products" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_favorite_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customer_addresses_customerId_idx" ON "customer_addresses"("customerId");

-- CreateIndex
CREATE INDEX "customer_devices_customerId_idx" ON "customer_devices"("customerId");

-- CreateIndex
CREATE INDEX "customer_favorite_businesses_customerId_idx" ON "customer_favorite_businesses"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_favorite_businesses_customerId_businessId_key" ON "customer_favorite_businesses"("customerId", "businessId");

-- CreateIndex
CREATE INDEX "customer_favorite_products_customerId_idx" ON "customer_favorite_products"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_favorite_products_customerId_productId_key" ON "customer_favorite_products"("customerId", "productId");

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_devices" ADD CONSTRAINT "customer_devices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_favorite_businesses" ADD CONSTRAINT "customer_favorite_businesses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_favorite_businesses" ADD CONSTRAINT "customer_favorite_businesses_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_favorite_products" ADD CONSTRAINT "customer_favorite_products_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_favorite_products" ADD CONSTRAINT "customer_favorite_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Negocios: estado operativo, horarios, categorías, ofertas ──

-- AlterTable: acceptingOrders es independiente de active (ver comentario en schema.prisma).
-- DEFAULT true preserva el comportamiento actual: todo negocio activo sigue recibiendo pedidos.
-- deliveryFeeBase es la tarifa base de mensajería para pedidos de la app (CUP); DEFAULT 250
-- dejar los negocios existentes en la tarifa estándar — los 5 negocios con mensajería a 350
-- se configuran a mano desde el dashboard después de este deploy.
ALTER TABLE "businesses" ADD COLUMN "acceptingOrders" BOOLEAN NOT NULL DEFAULT true,
                         ADD COLUMN "deliveryFeeBase" DECIMAL(10,2) NOT NULL DEFAULT 250;

-- CreateTable
CREATE TABLE "business_hours" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TIME NOT NULL,
    "closeTime" TIME NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_closures" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_closures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_hours_businessId_idx" ON "business_hours"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "business_hours_businessId_dayOfWeek_key" ON "business_hours"("businessId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "business_closures_businessId_idx" ON "business_closures"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "business_closures_businessId_date_key" ON "business_closures"("businessId", "date");

-- AddForeignKey
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_closures" ADD CONSTRAINT "business_closures_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: available distingue "agotado ahora" de active ("pertenece al catálogo").
-- categoryId es nullable y coexiste con el string legacy `category` (ver schema.prisma);
-- el backfill de categoryId para productos existentes es un paso aparte, posterior a esta
-- migración, no incluido aquí.
ALTER TABLE "products" ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true,
                        ADD COLUMN "categoryId" TEXT;

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_offers" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "product_offers_productId_idx" ON "product_offers"("productId");

-- CreateIndex
CREATE INDEX "product_offers_active_startsAt_endsAt_idx" ON "product_offers"("active", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- DropIndex + CreateIndex: "products_businessId_active_idx" se reemplaza por un
-- superconjunto que agrega "available". Cualquier consulta que filtraba solo por
-- (businessId, active) sigue usando este mismo índice sin cambios.
DROP INDEX "products_businessId_active_idx";
CREATE INDEX "products_businessId_active_available_idx" ON "products"("businessId", "active", "available");

-- DropIndex + CreateIndex: mismo caso que arriba, para "businesses_active_idx".
DROP INDEX "businesses_active_idx";
CREATE INDEX "businesses_active_acceptingOrders_idx" ON "businesses"("active", "acceptingOrders");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Pedidos: origen y cliente vinculado ──────────────────

-- AlterTable: "source" con DEFAULT 'MANUAL' preserva el origen real de todos los pedidos
-- históricos (siempre registrados por el equipo desde el dashboard). "customerId" nullable
-- porque la mayoría de los pedidos existentes no tienen un Customer asociado todavía.
ALTER TABLE "orders" ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'MANUAL',
                      ADD COLUMN "customerId" TEXT;

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: registeredByUserId pasa a ser nullable — un pedido creado por un Customer
-- desde la app no tiene un User de staff detrás. Relajar un NOT NULL es siempre seguro (no
-- reescribe filas, no puede fallar por datos existentes); los pedidos manuales del dashboard
-- lo siguen llenando siempre, ese flujo no cambia. El FK pasa de RESTRICT a SET NULL, el
-- comportamiento por defecto de Prisma para una relación opcional.
ALTER TABLE "orders" ALTER COLUMN "registeredByUserId" DROP NOT NULL;

ALTER TABLE "orders" DROP CONSTRAINT "orders_registeredByUserId_fkey";
ALTER TABLE "orders" ADD CONSTRAINT "orders_registeredByUserId_fkey" FOREIGN KEY ("registeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: clientRequestId para idempotencia de checkout — nullable/único, los pedidos
-- manuales del dashboard nunca lo usan.
ALTER TABLE "orders" ADD COLUMN "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_clientRequestId_key" ON "orders"("clientRequestId");

-- ── Versionado de catálogo (sincronización incremental) ──

-- CreateTable
CREATE TABLE "catalog_state" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_change_log" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "entityType" "CatalogEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "changeType" "CatalogChangeType" NOT NULL DEFAULT 'UPSERT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_change_log_version_idx" ON "catalog_change_log"("version");

-- CreateIndex
CREATE INDEX "catalog_change_log_entityType_entityId_idx" ON "catalog_change_log"("entityType", "entityId");

-- ── Imágenes (Fase 22: solo URL, nunca binario) ──────────

ALTER TABLE "products" ADD COLUMN "imageUrl" TEXT;

ALTER TABLE "businesses" ADD COLUMN "logoUrl" TEXT;

-- AlterTable: descripción de producto (opcional) y lowStock (independiente de available —
-- "queda poco" vs. "agotado").
ALTER TABLE "products" ADD COLUMN "description" TEXT,
                        ADD COLUMN "lowStock" BOOLEAN NOT NULL DEFAULT false;

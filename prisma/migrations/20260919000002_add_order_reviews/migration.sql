-- Reseñas de mensajero y de negocio, siempre ligadas a un pedido concreto.
-- Migración aditiva: solo tablas nuevas. ON DELETE RESTRICT sobre pedido/negocio/mensajero:
-- una reseña es histórica y nunca debe desaparecer por borrar el dato que valora.

-- CreateTable
CREATE TABLE "deliverer_reviews" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "delivererId" TEXT NOT NULL,
    "customerId" TEXT,
    "rating" DECIMAL(2,1) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliverer_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_reviews" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "rating" DECIMAL(2,1) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deliverer_reviews_orderId_key" ON "deliverer_reviews"("orderId");

-- CreateIndex
CREATE INDEX "deliverer_reviews_delivererId_idx" ON "deliverer_reviews"("delivererId");

-- CreateIndex
CREATE INDEX "deliverer_reviews_customerId_idx" ON "deliverer_reviews"("customerId");

-- CreateIndex
CREATE INDEX "business_reviews_businessId_idx" ON "business_reviews"("businessId");

-- CreateIndex
CREATE INDEX "business_reviews_customerId_idx" ON "business_reviews"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "business_reviews_orderId_businessId_key" ON "business_reviews"("orderId", "businessId");

-- AddForeignKey
ALTER TABLE "deliverer_reviews" ADD CONSTRAINT "deliverer_reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverer_reviews" ADD CONSTRAINT "deliverer_reviews_delivererId_fkey" FOREIGN KEY ("delivererId") REFERENCES "deliverers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverer_reviews" ADD CONSTRAINT "deliverer_reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- FK compuesta: el negocio valorado debe formar parte de ese pedido (order_businesses).
ALTER TABLE "business_reviews" ADD CONSTRAINT "business_reviews_orderId_businessId_fkey" FOREIGN KEY ("orderId", "businessId") REFERENCES "order_businesses"("orderId", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reviews" ADD CONSTRAINT "business_reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reviews" ADD CONSTRAINT "business_reviews_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reviews" ADD CONSTRAINT "business_reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rango del rating (Prisma no modela CHECK): 1.0 a 5.0.
ALTER TABLE "deliverer_reviews" ADD CONSTRAINT "deliverer_reviews_rating_range" CHECK ("rating" >= 1.0 AND "rating" <= 5.0);
ALTER TABLE "business_reviews" ADD CONSTRAINT "business_reviews_rating_range" CHECK ("rating" >= 1.0 AND "rating" <= 5.0);

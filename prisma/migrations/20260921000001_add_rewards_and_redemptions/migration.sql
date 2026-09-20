-- Canje de puntos V1: recompensas, canjes por pedido y descuento en el pedido.
-- Migración ADITIVA: enums/valores nuevos, tablas nuevas y columnas con DEFAULT 0. Ninguna fila
-- existente cambia; los pedidos actuales quedan con pointsDiscount = 0 (comportamiento idéntico).
-- Los nuevos valores del enum PointsTransactionType no se usan dentro de esta misma migración.

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('APPLIED', 'REFUNDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PointsTransactionType" ADD VALUE 'REDEMPTION';
ALTER TYPE "PointsTransactionType" ADD VALUE 'REDEMPTION_REFUND';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "pointsDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pointsRedeemed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "pointsDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "rewards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pointsCost" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "productId" TEXT NOT NULL,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "rewardName" TEXT NOT NULL,
    "pointsCost" INTEGER NOT NULL,
    "moneyValue" DECIMAL(10,2) NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'APPLIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rewards_active_idx" ON "rewards"("active");

-- CreateIndex
CREATE INDEX "rewards_productId_idx" ON "rewards"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_orderId_key" ON "reward_redemptions"("orderId");

-- CreateIndex
CREATE INDEX "reward_redemptions_customerId_createdAt_idx" ON "reward_redemptions"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "reward_redemptions_rewardId_idx" ON "reward_redemptions"("rewardId");

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "rewards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Defensa en profundidad (Prisma no modela CHECK): montos y costos coherentes.
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_pointsCost_positive" CHECK ("pointsCost" > 0);
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_pointsCost_positive" CHECK ("pointsCost" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_pointsDiscount_nonnegative" CHECK ("pointsDiscount" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_points_nonnegative" CHECK ("pointsRedeemed" >= 0 AND "pointsDiscount" >= 0);

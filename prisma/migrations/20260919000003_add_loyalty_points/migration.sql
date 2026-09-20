-- Puntos de fidelización V1. Migración aditiva: columnas nuevas con default, un enum y una tabla
-- nueva. No modifica ni elimina datos existentes. Los pedidos ya completados NO generan puntos
-- retroactivos: system_config.pointsEnabledFrom queda en el momento de aplicar esta migración
-- (DEFAULT now() rellena la fila existente) y solo cuentan los pedidos completados desde entonces.

-- CreateEnum
CREATE TYPE "PointsTransactionType" AS ENUM ('ORDER_COMPLETED', 'ORDER_ADJUSTMENT', 'FIRST_ORDER_BONUS');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "pointsBalance" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "system_config" ADD COLUMN "pointsServiceDivisor" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "pointsFirstOrderBonus" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "pointsEnabledFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "points_transactions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "PointsTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "orderId" TEXT,
    "orderNumber" INTEGER,
    "serviceFee" DECIMAL(10,2) NOT NULL,
    "divisor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "points_transactions_dedupeKey_key" ON "points_transactions"("dedupeKey");

-- CreateIndex
CREATE INDEX "points_transactions_customerId_createdAt_idx" ON "points_transactions"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "points_transactions_orderId_idx" ON "points_transactions"("orderId");

-- AddForeignKey
-- RESTRICT: el historial de puntos de un cliente nunca desaparece por borrar al cliente.
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariantes que Prisma no modela: un movimiento nunca es cero, y el divisor es positivo.
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_points_nonzero" CHECK ("points" <> 0);
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_divisor_positive" CHECK ("divisor" >= 1);
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_points_divisor_positive" CHECK ("pointsServiceDivisor" >= 1);
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_points_first_bonus_nonnegative" CHECK ("pointsFirstOrderBonus" >= 0);

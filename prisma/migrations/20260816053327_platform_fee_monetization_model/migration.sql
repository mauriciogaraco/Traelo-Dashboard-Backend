-- Nuevo modelo de monetización: "Servicio Tráelo" pasa a ser un cargo explícito
-- sumado al total (platformFee), en vez de restarse silenciosamente del negocio.
-- Ningún dato existente se elimina: los renames usan RENAME COLUMN (preserva valores),
-- y las columnas nuevas usan DEFAULT 0 / NULL para pedidos ya creados (ver notas en schema.prisma).

-- CreateEnum
CREATE TYPE "BusinessSettlementStatus" AS ENUM ('PENDING', 'PAID');

-- AlterTable: snapshots históricos por negocio dentro del pedido (nullable: pedidos previos
-- a este cambio nunca capturaron esta información, no se inventa un valor falso)
ALTER TABLE "order_businesses"
  ADD COLUMN "businessNameSnapshot" TEXT,
  ADD COLUMN "commissionTypeSnapshot" "CommissionType",
  ADD COLUMN "commissionRateSnapshot" DECIMAL(5,2);

-- AlterTable: "Servicio Tráelo" (cargo visible, redondeado) y la parte de Tráelo en mensajería,
-- ahora guardada explícita en vez de derivarse por resta en cada consulta
ALTER TABLE "orders"
  ADD COLUMN "platformFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "traeloDeliveryShare" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable: renombrar (no reemplazar) los campos del cuadre del mensajero para que el
-- nombre diga lo que es; RENAME COLUMN preserva los valores existentes.
ALTER TABLE "settlements" RENAME COLUMN "productCommissions" TO "platformFeeCollected";
ALTER TABLE "settlements" RENAME COLUMN "traeloShare" TO "traeloDeliveryShare";

-- CreateTable: preparado para la liquidación a negocios (sin service/rutas todavía)
CREATE TABLE "business_settlements" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "grossSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "platformFeeEarned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "BusinessSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_settlements_businessId_status_idx" ON "business_settlements"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_settlements_businessId_periodStart_periodEnd_key" ON "business_settlements"("businessId", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "business_settlements" ADD CONSTRAINT "business_settlements_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

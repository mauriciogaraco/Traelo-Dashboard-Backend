-- Seguimiento en vivo del pedido (V1): última ubicación conocida del mensajero y coordenadas
-- del destino. Migración aditiva: una tabla nueva y dos columnas nullable.
-- Sin histórico GPS: deliverer_locations guarda UNA fila por mensajero (unique) que se pisa.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "destinationLatitude" DOUBLE PRECISION,
ADD COLUMN     "destinationLongitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "deliverer_locations" (
    "id" TEXT NOT NULL,
    "delivererId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliverer_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deliverer_locations_delivererId_key" ON "deliverer_locations"("delivererId");

-- AddForeignKey
ALTER TABLE "deliverer_locations" ADD CONSTRAINT "deliverer_locations_delivererId_fkey" FOREIGN KEY ("delivererId") REFERENCES "deliverers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

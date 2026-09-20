-- Ubicación exacta OPCIONAL de las direcciones guardadas (pin manual). Migración aditiva: un enum
-- nuevo y cuatro columnas nullable; ninguna fila existente cambia ni se rechaza.

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('MANUAL_PIN', 'DEVICE_LOCATION');

-- AlterTable
ALTER TABLE "customer_addresses" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "locationAccuracy" DOUBLE PRECISION,
ADD COLUMN     "locationSource" "LocationSource",
ADD COLUMN     "longitude" DOUBLE PRECISION;

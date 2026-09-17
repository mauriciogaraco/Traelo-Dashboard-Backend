-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "raffleNumber" INTEGER;

-- AlterTable
ALTER TABLE "system_config" ADD COLUMN     "rafflePromoText" TEXT,
ADD COLUMN     "raffleVideoUrl" TEXT;

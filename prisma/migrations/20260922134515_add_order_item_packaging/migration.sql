-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "packagingFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "packagingName" TEXT;

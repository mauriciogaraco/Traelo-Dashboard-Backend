-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'BUSINESS_OWNER';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "businessId" TEXT;

-- CreateIndex
CREATE INDEX "users_businessId_idx" ON "users"("businessId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

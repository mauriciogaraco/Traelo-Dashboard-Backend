-- AlterTable
ALTER TABLE "deliverers" ADD COLUMN     "expoPushToken" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "lastReminderPushAt" TIMESTAMP(3);

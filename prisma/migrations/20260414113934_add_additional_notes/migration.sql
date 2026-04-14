-- DropIndex
DROP INDEX "WorkTicket_workItemId_systemName_key";

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN "additionalNotes" TEXT;

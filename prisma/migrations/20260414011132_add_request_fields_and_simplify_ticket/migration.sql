/*
  Warnings:

  - You are about to drop the column `ticketUrl` on the `WorkTicket` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN "requestContent" TEXT;
ALTER TABLE "WorkItem" ADD COLUMN "requestNumber" TEXT;
ALTER TABLE "WorkItem" ADD COLUMN "requestType" TEXT;
ALTER TABLE "WorkItem" ADD COLUMN "requestor" TEXT;

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workItemId" TEXT NOT NULL,
    "systemName" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "WorkTicket_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WorkTicket" ("createdAt", "deletedAt", "id", "systemName", "ticketNumber", "updatedAt", "workItemId") SELECT "createdAt", "deletedAt", "id", "systemName", "ticketNumber", "updatedAt", "workItemId" FROM "WorkTicket";
DROP TABLE "WorkTicket";
ALTER TABLE "new_WorkTicket" RENAME TO "WorkTicket";
CREATE INDEX "WorkTicket_workItemId_idx" ON "WorkTicket"("workItemId");
CREATE INDEX "WorkTicket_deletedAt_idx" ON "WorkTicket"("deletedAt");
CREATE UNIQUE INDEX "WorkTicket_workItemId_systemName_key" ON "WorkTicket"("workItemId", "systemName");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

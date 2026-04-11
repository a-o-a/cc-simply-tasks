-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workItemId" TEXT NOT NULL,
    "systemName" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "ticketUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "WorkTicket_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WorkTicket" ("createdAt", "deletedAt", "id", "systemName", "ticketNumber", "ticketUrl", "updatedAt", "workItemId") SELECT "createdAt", "deletedAt", "id", "systemName", "ticketNumber", "ticketUrl", "updatedAt", "workItemId" FROM "WorkTicket";
DROP TABLE "WorkTicket";
ALTER TABLE "new_WorkTicket" RENAME TO "WorkTicket";
CREATE INDEX "WorkTicket_workItemId_idx" ON "WorkTicket"("workItemId");
CREATE INDEX "WorkTicket_ticketNumber_idx" ON "WorkTicket"("ticketNumber");
CREATE INDEX "WorkTicket_deletedAt_idx" ON "WorkTicket"("deletedAt");
CREATE UNIQUE INDEX "WorkTicket_workItemId_systemName_ticketNumber_key" ON "WorkTicket"("workItemId", "systemName", "ticketNumber");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

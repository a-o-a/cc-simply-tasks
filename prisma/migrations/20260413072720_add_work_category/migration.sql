-- CreateTable
CREATE TABLE "WorkCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "order" INTEGER NOT NULL DEFAULT 0,
    "assigneeId" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "transferDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "WorkItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WorkItem" ("assigneeId", "category", "createdAt", "deletedAt", "description", "endDate", "id", "order", "priority", "startDate", "status", "title", "transferDate", "updatedAt") SELECT "assigneeId", "category", "createdAt", "deletedAt", "description", "endDate", "id", "order", "priority", "startDate", "status", "title", "transferDate", "updatedAt" FROM "WorkItem";
DROP TABLE "WorkItem";
ALTER TABLE "new_WorkItem" RENAME TO "WorkItem";
CREATE INDEX "WorkItem_assigneeId_status_idx" ON "WorkItem"("assigneeId", "status");
CREATE INDEX "WorkItem_transferDate_idx" ON "WorkItem"("transferDate");
CREATE INDEX "WorkItem_startDate_endDate_idx" ON "WorkItem"("startDate", "endDate");
CREATE INDEX "WorkItem_deletedAt_idx" ON "WorkItem"("deletedAt");
CREATE INDEX "WorkItem_status_idx" ON "WorkItem"("status");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE UNIQUE INDEX "WorkCategory_code_key" ON "WorkCategory"("code");

-- CreateIndex
CREATE INDEX "WorkCategory_deletedAt_idx" ON "WorkCategory"("deletedAt");
